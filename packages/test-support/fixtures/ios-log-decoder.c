#include <assert.h>
#define main collector_main
#include "../../native/ios-logs/collector.c"
#undef main
void mobile_dev_telemetry_init(const char *component) { (void)component; }
double mobile_dev_telemetry_now(void) { return 0; }
void mobile_dev_telemetry_timing(enum mobile_dev_timing kind, double duration) { (void)kind; (void)duration; }

int main(void) {
    const char path[] = "/Applications/Example.app/Example";
    const char image[] = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
    const char message[] = "line\n\"quoted\" and C:\\\\folder\\\"file\" 🌍";
    const char subsystem[] = "com.example.app";
    const char category[] = "javascript";
    char packet[1024] = { 0 };
    struct ostrace_packet_header_t header = { 0 };
    header.marker = 2;
    header.type = 8;
    header.header_size = sizeof(header);
    header.pid = 123;
    header.time_sec = 42;
    header.time_usec = 123456;
    header.level = 0x10;
    header.procpath_len = sizeof(path);
    header.imagepath_len = sizeof(image);
    header.message_len = sizeof(message);
    header.subsystem_len = sizeof(subsystem);
    header.category_len = sizeof(category);
    size_t offset = sizeof(header);
    memcpy(packet + offset, path, sizeof(path)); offset += sizeof(path);
    memcpy(packet + offset, image, sizeof(image)); offset += sizeof(image);
    memcpy(packet + offset, message, sizeof(message)); offset += sizeof(message);
    memcpy(packet + offset, subsystem, sizeof(subsystem)); offset += sizeof(subsystem);
    memcpy(packet + offset, category, sizeof(category)); offset += sizeof(category);
    memcpy(packet, &header, sizeof(header));
    int result = emit_record(packet, (uint32_t)offset, "Other");
    assert(result == 0);
    result = emit_record(packet, (uint32_t)offset, "Example");
    assert(result == 0);

    header.type = 2;
    header.pid = 456;
    header.subsystem_len = 0;
    header.category_len = 3;
    memcpy(packet, &header, sizeof(header));
    uint32_t unlabeled_length = sizeof(header) + sizeof(path) + sizeof(image) + sizeof(message);
    result = emit_record(packet, unlabeled_length, "Example");
    assert(result == 0);

    header.header_size = UINT32_MAX;
    memcpy(packet, &header, sizeof(header));
    result = emit_record(packet, unlabeled_length, NULL);
    assert(result == -1);
    header.header_size = sizeof(header);
    header.message_len = UINT32_MAX;
    memcpy(packet, &header, sizeof(header));
    result = emit_record(packet, unlabeled_length, NULL);
    assert(result == -1);
    header.message_len = sizeof(message);
    memcpy(packet, &header, sizeof(header));
    packet[unlabeled_length - 1] = 1;
    result = emit_record(packet, unlabeled_length, NULL);
    assert(result == -1);
    return 0;
}
