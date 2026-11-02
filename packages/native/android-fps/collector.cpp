#include "perfetto/perfetto.h"
#include <atomic>
#include <condition_variable>
#include <csignal>
#include <cstdio>
#include <mutex>
#include <poll.h>
#include <time.h>
#include <unistd.h>
#include "../telemetry/telemetry.h"

static volatile sig_atomic_t stopping = 0;
static void stop(int) { stopping = 1; }

static uint64_t boottime() {
  timespec time{};
  clock_gettime(CLOCK_BOOTTIME, &time);
  return uint64_t(time.tv_sec) * 1000000000 + uint64_t(time.tv_nsec);
}

int main() {
  mobile_dev_telemetry_init("android-fps");
  std::signal(SIGINT, stop);
  std::signal(SIGTERM, stop);
  std::signal(SIGPIPE, stop);
  perfetto::TracingInitArgs args;
  args.backends = perfetto::kSystemBackend;
  perfetto::Tracing::Initialize(args);
  perfetto::TraceConfig config;
  auto* buffer = config.add_buffers();
  buffer->set_size_kb(4096);
  auto* data_source = config.add_data_sources();
  auto* source = data_source->mutable_config();
  source->set_name("android.surfaceflinger.frametimeline");
  auto session = perfetto::Tracing::NewTrace(perfetto::kSystemBackend);
  std::atomic<bool> failed{false};
  session->SetOnErrorCallback([&](perfetto::TracingError error) {
    const char* message = error.message.c_str();
    std::fprintf(stderr, "Perfetto: %s\n", message);
    failed = true;
  });
  session->Setup(config);
  session->StartBlocking();
  while (stopping == 0 && failed == false) {
    pollfd input{STDIN_FILENO, POLLIN | POLLHUP, 0};
    int result = poll(&input, 1, 1000);
    if (result > 0 || stopping) break;
    double read_started = mobile_dev_telemetry_now();
    if (session->FlushBlocking(3000) == false) {
      std::fprintf(stderr, "FrameTimeline did not acknowledge a flush.\n");
      failed = true;
      break;
    }
    std::mutex mutex;
    std::condition_variable changed;
    bool complete = false;
    session->ReadTrace([&](perfetto::TracingSession::ReadTraceCallbackArgs chunk) {
      if (chunk.size && std::fwrite(chunk.data, 1, chunk.size, stdout) != chunk.size) failed = true;
      if (chunk.has_more == false) {
        std::lock_guard<std::mutex> lock(mutex);
        complete = true;
        changed.notify_one();
      }
    });
    std::unique_lock<std::mutex> lock(mutex);
    changed.wait(lock, [&] { return complete; });
    if (failed) break;
    protozero::HeapBuffered<perfetto::protos::pbzero::TracePacket> packet;
    const auto timestamp = boottime();
    packet->set_timestamp(timestamp);
    auto* service_event = packet->set_service_event();
    service_event->set_read_tracing_buffers_completed(true);
    auto bytes = packet.SerializeAsString();
    uint8_t header[16] = {10};
    size_t length = bytes.size();
    size_t count = 1;
    do {
      header[count++] = (length & 127) | (length > 127 ? 128 : 0);
      length >>= 7;
    } while (length);
    std::fwrite(header, 1, count, stdout);
    const char* packet_bytes = bytes.data();
    const size_t packet_size = bytes.size();
    std::fwrite(packet_bytes, 1, packet_size, stdout);
    std::fflush(stdout);
    double finished = mobile_dev_telemetry_now();
    double read_ms = finished - read_started;
    mobile_dev_telemetry_timing(MOBILE_DEV_FPS_READ, read_ms);
  }
  session->StopBlocking();
  return failed ? 1 : 0;
}
