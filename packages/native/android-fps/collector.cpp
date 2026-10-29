#include "perfetto/perfetto.h"
#include <atomic>
#include <cerrno>
#include <condition_variable>
#include <csignal>
#include <cstdio>
#include <mutex>
#include <poll.h>
#include <string>
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

static void json_string(const std::string& value) {
  std::fputc('"', stdout);
  for (unsigned char ch : value) {
    if (ch == '"' || ch == '\\') {
      std::fputc('\\', stdout);
      std::fputc(ch, stdout);
    } else if (ch < 0x20) {
      std::fprintf(stdout, "\\u%04x", ch);
    } else {
      std::fputc(ch, stdout);
    }
  }
  std::fputc('"', stdout);
}

// Control records are JSON lines between trace packets: a packet starts with its
// field tag (10), a record with '{'.
static void write_error(const std::string& cause, const std::string& message) {
  std::fprintf(stderr, "%s\n", message.c_str());
  std::fputs("{\"type\":\"error\",\"cause\":", stdout);
  json_string(cause);
  std::fputs(",\"message\":", stdout);
  json_string(message);
  std::fputs("}\n", stdout);
  std::fflush(stdout);
}

int main() {
  mobile_dev_telemetry_init("android-fps");
  std::signal(SIGINT, stop);
  std::signal(SIGTERM, stop);
  // A closed ADB pipe stops the collector through EPIPE.
  std::signal(SIGPIPE, SIG_IGN);
  std::mutex failure_mutex;
  std::string failure_cause;
  std::string failure_message;
  std::atomic<bool> failed{false};
  std::atomic<bool> closed{false};
  auto fail = [&](const char* cause, const std::string& message) {
    std::lock_guard<std::mutex> lock(failure_mutex);
    if (failure_cause.empty()) {
      failure_cause = cause;
      failure_message = message;
    }
    failed = true;
  };
  // Must run on the thread that wrote, while errno is still that write's.
  auto output_failed = [&] {
    if (errno == EPIPE) closed = true;
    else fail("output_failed", "The Display FPS output stream failed.");
  };
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
  session->SetOnErrorCallback([&](perfetto::TracingError error) { fail("tracing_failed", "Perfetto: " + error.message); });
  session->Setup(config);
  session->StartBlocking();
  if (failed == false) {
    std::fputs("{\"type\":\"ready\"}\n", stdout);
    if (std::fflush(stdout) != 0) output_failed();
  }
  while (stopping == 0 && failed == false && closed == false) {
    pollfd input{STDIN_FILENO, POLLIN | POLLHUP, 0};
    int result = poll(&input, 1, 1000);
    if (result > 0 || stopping) break;
    double read_started = mobile_dev_telemetry_now();
    if (session->FlushBlocking(3000) == false) {
      fail("flush_timeout", "FrameTimeline did not acknowledge a flush.");
      break;
    }
    std::mutex mutex;
    std::condition_variable changed;
    bool complete = false;
    session->ReadTrace([&](perfetto::TracingSession::ReadTraceCallbackArgs chunk) {
      if (chunk.size && closed == false && std::fwrite(chunk.data, 1, chunk.size, stdout) != chunk.size) output_failed();
      if (chunk.has_more == false) {
        std::lock_guard<std::mutex> lock(mutex);
        complete = true;
        changed.notify_one();
      }
    });
    std::unique_lock<std::mutex> lock(mutex);
    changed.wait(lock, [&] { return complete; });
    if (failed || closed) break;
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
    if (std::fflush(stdout) != 0) {
      output_failed();
      break;
    }
    double finished = mobile_dev_telemetry_now();
    double read_ms = finished - read_started;
    mobile_dev_telemetry_timing(MOBILE_DEV_FPS_READ, read_ms);
  }
  session->StopBlocking();
  if (closed || failed == false) return 0;
  std::lock_guard<std::mutex> lock(failure_mutex);
  write_error(failure_cause, failure_message);
  return 1;
}
