/* SPDX-License-Identifier: LGPL-2.1-or-later
 * OS trace framing follows libimobiledevice's src/ostrace.c.
 * Copyright (c) 2020-2025 Nikias Bassen (upstream framing).
 */
#include <libkern/OSByteOrder.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <libimobiledevice/afc.h>
#include <libimobiledevice/libimobiledevice.h>
#include <libimobiledevice/lockdown.h>
#include <libimobiledevice/ostrace.h>
#include <libimobiledevice/service.h>
#include <plist/plist.h>
#include "../telemetry/telemetry.h"

#define MAX_PACKET (1024 * 1024)
#define MAX_MESSAGE 16384
#define MAX_REPORT (8 * 1024 * 1024)

static volatile sig_atomic_t stopping = 0;

static void stop(int signal_number) {
    (void)signal_number;
    stopping = 1;
}

static int receive_exact(service_client_t client, void *buffer, uint32_t length) {
    uint32_t offset = 0;
    while (offset < length && stopping == 0) {
        uint32_t received = 0;
        service_error_t result = service_receive_with_timeout(client, (char *)buffer + offset, length - offset, &received, 200);
        offset += received;
        if (result == SERVICE_E_TIMEOUT) continue;
        if (result != SERVICE_E_SUCCESS || received == 0) {
            if (stopping == 0) fprintf(stderr, "The iOS log connection closed (%d).\n", result);
            return -1;
        }
    }
    return offset == length ? 0 : -1;
}

static int receive_packet(service_client_t client, char **buffer, uint32_t *length, uint8_t *type) {
    uint32_t size = 0;
    int result = receive_exact(client, type, 1);
    if (result != 0) return -1;
    result = receive_exact(client, &size, sizeof(size));
    if (result != 0) return -1;
    if (*type == 1) size = OSSwapBigToHostInt32(size);
    else if (*type == 2) size = OSSwapLittleToHostInt32(size);
    else {
        fprintf(stderr, "Unsupported iOS log packet type: %u.\n", *type);
        return -1;
    }
    if (size == 0 || size > MAX_PACKET) {
        fprintf(stderr, "Invalid iOS log packet length: %u.\n", size);
        return -1;
    }
    char *bytes = malloc(size);
    if (bytes == NULL) return -1;
    result = receive_exact(client, bytes, size);
    if (result != 0) {
        free(bytes);
        return -1;
    }
    *buffer = bytes;
    *length = size;
    return 0;
}

static int send_exact(service_client_t client, const char *bytes, uint32_t length) {
    uint32_t offset = 0;
    while (offset < length && stopping == 0) {
        uint32_t sent = 0;
        service_error_t result = service_send(client, bytes + offset, length - offset, &sent);
        if (result != SERVICE_E_SUCCESS || sent == 0) return -1;
        offset += sent;
    }
    return offset == length ? 0 : -1;
}

static void set_number(plist_t dict, const char *key, uint64_t value) {
    plist_t node = plist_new_uint(value);
    plist_dict_set_item(dict, key, node);
}

static void set_string(plist_t dict, const char *key, const char *value) {
    plist_t node = plist_new_string(value);
    plist_dict_set_item(dict, key, node);
}

static int start_activity(service_client_t client) {
    plist_t request = plist_new_dict();
    set_string(request, "Request", "StartActivity");
    set_number(request, "Pid", UINT32_MAX);
    set_number(request, "MessageFilter", 0xffff);
    set_number(request, "StreamFlags", 0x3c);
    char *bytes = NULL;
    uint32_t length = 0;
    plist_err_t encoded = plist_to_bin(request, &bytes, &length);
    plist_free(request);
    if (encoded != PLIST_ERR_SUCCESS) return -1;
    uint32_t prefix = OSSwapHostToBigInt32(length);
    int result = send_exact(client, (const char *)&prefix, sizeof(prefix));
    if (result == 0) result = send_exact(client, bytes, length);
    free(bytes);
    if (result != 0) return -1;
    uint8_t type = 0;
    result = receive_packet(client, &bytes, &length, &type);
    if (result != 0) return -1;
    plist_t reply = NULL;
    plist_err_t decoded = plist_from_memory(bytes, length, &reply, NULL);
    free(bytes);
    if (decoded != PLIST_ERR_SUCCESS) return -1;
    plist_t status_node = plist_dict_get_item(reply, "Status");
    const char *status = status_node == NULL ? NULL : plist_get_string_ptr(status_node, NULL);
    int accepted = status == NULL ? 0 : strcmp(status, "RequestSuccessful") == 0;
    if (accepted == 0) fprintf(stderr, "The device rejected unified-log streaming. Unlock the paired iPhone and retry.\n");
    plist_free(reply);
    return accepted ? 0 : -1;
}

static void json_string(const char *bytes, size_t size, size_t limit) {
    if (size > limit) size = limit;
    while (size > 0 && ((unsigned char)bytes[size] & 0xc0) == 0x80) size--;
    fputc('"', stdout);
    size_t start = 0;
    for (size_t index = 0; index < size; index++) {
        unsigned char ch = (unsigned char)bytes[index];
        if (ch == '"' || ch == '\\' || ch < 0x20) {
            fwrite(bytes + start, 1, index - start, stdout);
            if (ch < 0x20) fprintf(stdout, "\\u%04x", ch);
            else { fputc('\\', stdout); fputc(ch, stdout); }
            start = index + 1;
        }
    }
    fwrite(bytes + start, 1, size - start, stdout);
    fputc('"', stdout);
}

static void json_field(const char *key, const char *value, size_t limit) {
    fprintf(stdout, ",\"%s\":", key);
    size_t length = strlen(value);
    json_string(value, length, limit);
}

static int emit_record(const char *bytes, uint32_t length, const char *process_filter) {
    if (length < sizeof(struct ostrace_packet_header_t)) {
        fprintf(stderr, "Short trace header: %u bytes.\n", length);
        return -1;
    }
    struct ostrace_packet_header_t header;
    memcpy(&header, bytes, sizeof(header));
    if (header.marker != 2 || (header.type != 8 && header.type != 2)) {
        fprintf(stderr, "Unsupported trace record: marker=%u type=%u bytes=%u.\n", header.marker, header.type, length);
        return -1;
    }
    size_t offset = header.header_size;
    if (offset < sizeof(header) || offset > length) {
        fprintf(stderr, "Invalid trace header size: %zu/%u.\n", offset, length);
        return -1;
    }
    // The relay appends labels only when both lengths are nonzero.
    int has_label = header.subsystem_len > 0 && header.category_len > 0;
    const size_t lengths[] = { header.procpath_len, header.imagepath_len, header.message_len,
        has_label ? header.subsystem_len : 0, has_label ? header.category_len : 0 };
    const char *fields[5];
    for (size_t index = 0; index < 5; index++) {
        if (lengths[index] > length - offset) {
            fprintf(stderr, "Truncated trace field %zu: %zu/%zu; type=%u header=%u fields=%u,%u,%u,%u,%u bytes=%u.\n",
                index, lengths[index], length - offset, header.type, header.header_size, header.procpath_len,
                header.imagepath_len, header.message_len, header.subsystem_len, header.category_len, length);
            return -1;
        }
        fields[index] = bytes + offset;
        if (lengths[index] > 0) {
            const char *end = memchr(fields[index], '\0', lengths[index]);
            if (end == NULL) {
                fprintf(stderr, "Non-terminated trace field %zu: %zu bytes.\n", index, lengths[index]);
                return -1;
            }
        }
        offset += lengths[index];
    }
    if (lengths[0] == 0 || lengths[2] == 0) return 0;
    const char *name = strrchr(fields[0], '/');
    name = name == NULL ? fields[0] : name + 1;
    if (process_filter != NULL && strcmp(name, process_filter) != 0) return 0;
    time_t seconds = (time_t)header.time_sec;
    struct tm date;
    if (gmtime_r(&seconds, &date) == NULL || header.time_usec >= 1000000) return -1;
    char timestamp[40];
    size_t formatted = strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%S", &date);
    if (formatted == 0) return -1;
    snprintf(timestamp + formatted, sizeof(timestamp) - formatted, ".%06uZ", header.time_usec);
    const char *level = "Notice";
    switch (header.level) {
        case 1: level = "Info"; break;
        case 2: level = "Debug"; break;
        case 0x10: level = "Error"; break;
        case 0x11: level = "Fault"; break;
    }
    fprintf(stdout, "{\"timestamp\":\"%s\",\"messageType\":\"%s\",\"processID\":%u", timestamp, level, header.pid);
    json_field("process", name, 1024);
    json_field("eventMessage", fields[2], MAX_MESSAGE);
    if (lengths[1] > 0) json_field("senderImagePath", fields[1], 4096);
    if (has_label) {
        json_field("subsystem", fields[3], 1024);
        json_field("category", fields[4], 1024);
    }
    fputs("}\n", stdout);
    int failed = ferror(stdout);
    return failed ? -1 : 0;
}

// The mover replies "ping" once pending crash reports are in the directory the copy service reads.
static int move_crash_reports(idevice_t device, lockdownd_client_t lockdown) {
    lockdownd_service_descriptor_t descriptor = NULL;
    lockdownd_error_t started = lockdownd_start_service(lockdown, "com.apple.crashreportmover", &descriptor);
    if (started != LOCKDOWN_E_SUCCESS) {
        fprintf(stderr, "Cannot start the crash report mover: %s. Unlock the iPhone and retry.\n", lockdownd_strerror(started));
        return -1;
    }
    service_client_t mover = NULL;
    service_error_t connected = service_client_new(device, descriptor, &mover);
    lockdownd_service_descriptor_free(descriptor);
    if (connected != SERVICE_E_SUCCESS) {
        fprintf(stderr, "Cannot open the crash report mover (%d).\n", connected);
        return -1;
    }
    char ping[4] = { 0 };
    uint32_t received = 0;
    for (int attempt = 0; attempt < 10 && received < sizeof(ping) && stopping == 0; attempt++) {
        uint32_t bytes = 0;
        service_error_t result = service_receive_with_timeout(mover, ping + received, sizeof(ping) - received, &bytes, 2000);
        received += bytes;
        if (result != SERVICE_E_SUCCESS && result != SERVICE_E_TIMEOUT) break;
    }
    service_client_free(mover);
    if (received == sizeof(ping) && memcmp(ping, "ping", sizeof(ping)) == 0) return 0;
    fprintf(stderr, "The iPhone did not finish moving its crash reports.\n");
    return -1;
}

static char *read_report(afc_client_t afc, const char *path, uint64_t size) {
    uint64_t handle = 0;
    if (afc_file_open(afc, path, AFC_FOPEN_RDONLY, &handle) != AFC_E_SUCCESS) return NULL;
    char *text = malloc(size + 1);
    uint64_t offset = 0;
    while (text != NULL && offset < size) {
        uint32_t bytes = 0;
        afc_error_t result = afc_file_read(afc, handle, text + offset, (uint32_t)(size - offset), &bytes);
        if (result != AFC_E_SUCCESS || bytes == 0) break;
        offset += bytes;
    }
    afc_file_close(afc, handle);
    if (text == NULL || offset != size) {
        free(text);
        return NULL;
    }
    text[size] = '\0';
    return text;
}

// Print each .ips report modified at or after since_ms as {"name","modified","text"}.
static int copy_crash_reports(idevice_t device, lockdownd_client_t lockdown, uint64_t since_ms) {
    lockdownd_service_descriptor_t descriptor = NULL;
    lockdownd_error_t started = lockdownd_start_service(lockdown, "com.apple.crashreportcopymobile", &descriptor);
    if (started != LOCKDOWN_E_SUCCESS) {
        fprintf(stderr, "Cannot open crash reports: %s. Unlock the iPhone and retry.\n", lockdownd_strerror(started));
        return -1;
    }
    afc_client_t afc = NULL;
    afc_error_t connected = afc_client_new(device, descriptor, &afc);
    lockdownd_service_descriptor_free(descriptor);
    if (connected != AFC_E_SUCCESS) {
        fprintf(stderr, "Cannot read crash reports (%d).\n", connected);
        return -1;
    }
    char **names = NULL;
    afc_error_t listed = afc_read_directory(afc, "/", &names);
    int result = listed == AFC_E_SUCCESS ? 0 : -1;
    if (result != 0) fprintf(stderr, "Cannot list crash reports (%d).\n", listed);
    for (size_t index = 0; result == 0 && names != NULL && names[index] != NULL && stopping == 0; index++) {
        const char *name = names[index];
        size_t length = strlen(name);
        if (length < 5 || strcmp(name + length - 4, ".ips") != 0) continue;
        char path[1024];
        if (snprintf(path, sizeof(path), "/%s", name) >= (int)sizeof(path)) continue;
        plist_t info = NULL;
        if (afc_get_file_info_plist(afc, path, &info) != AFC_E_SUCCESS || info == NULL) continue;
        const char *format = plist_get_string_ptr(plist_dict_get_item(info, "st_ifmt"), NULL);
        int regular = format != NULL && strcmp(format, "S_IFREG") == 0;
        uint64_t size = plist_dict_get_uint(info, "st_size");
        uint64_t modified_ms = plist_dict_get_uint(info, "st_mtime") / 1000000;
        plist_free(info);
        if (regular == 0 || modified_ms < since_ms) continue;
        if (size == 0 || size > MAX_REPORT) {
            fprintf(stderr, "Skipping crash report %s: %llu bytes.\n", name, (unsigned long long)size);
            continue;
        }
        char *text = read_report(afc, path, size);
        if (text == NULL) {
            fprintf(stderr, "Cannot read crash report %s.\n", name);
            continue;
        }
        fputs("{\"name\":", stdout);
        json_string(name, length, 1024);
        fprintf(stdout, ",\"modified\":%llu", (unsigned long long)modified_ms);
        json_field("text", text, MAX_REPORT);
        fputs("}\n", stdout);
        free(text);
        if (ferror(stdout)) result = -1;
    }
    if (names != NULL) afc_dictionary_free(names);
    afc_client_free(afc);
    return result;
}

static int stream_logs(idevice_t device, lockdownd_client_t *lockdown, const char *filter, double connected_at) {
    lockdownd_service_descriptor_t descriptor = NULL;
    service_client_t client = NULL;
    int result = -1;
    lockdownd_error_t started = lockdownd_start_service(*lockdown, OSTRACE_SERVICE_NAME, &descriptor);
    if (started != LOCKDOWN_E_SUCCESS) {
        const char *description = lockdownd_strerror(started);
        fprintf(stderr, "Cannot start unified logs: %s. Unlock the iPhone and retry.\n", description);
        goto cleanup;
    }
    service_error_t connected = service_client_new(device, descriptor, &client);
    if (connected != SERVICE_E_SUCCESS) {
        fprintf(stderr, "Cannot open the iOS unified-log relay (%d).\n", connected);
        goto cleanup;
    }
    lockdownd_service_descriptor_free(descriptor);
    descriptor = NULL;
    lockdownd_client_free(*lockdown);
    *lockdown = NULL;
    result = start_activity(client);
    if (result != 0) goto cleanup;
    puts("{\"ready\":true}");
    double ready_at = mobile_dev_telemetry_now();
    double connect_ms = ready_at - connected_at;
    mobile_dev_telemetry_timing(MOBILE_DEV_CONNECT, connect_ms);
    while (stopping == 0) {
        char *bytes = NULL;
        uint32_t length = 0;
        uint8_t type = 0;
        result = receive_packet(client, &bytes, &length, &type);
        if (result != 0) break;
        double process_at = mobile_dev_telemetry_now();
        result = emit_record(bytes, length, filter);
        double processed_at = mobile_dev_telemetry_now();
        double process_ms = processed_at - process_at;
        mobile_dev_telemetry_timing(MOBILE_DEV_LOG_PROCESS, process_ms);
        free(bytes);
        if (result != 0) {
            fprintf(stderr, "Invalid unified-log record or closed output stream.\n");
            break;
        }
    }
cleanup:
    if (client != NULL) service_client_free(client);
    if (descriptor != NULL) lockdownd_service_descriptor_free(descriptor);
    return result;
}

int main(int argc, char **argv) {
    mobile_dev_telemetry_init("ios-logs");
    double connected_at = mobile_dev_telemetry_now();
    int reports = argc == 6 && strcmp(argv[4], "--crash-reports") == 0;
    char *since_end = NULL;
    unsigned long long since_ms = reports ? strtoull(argv[5], &since_end, 10) : 0;
    if (argc < 4 || argc > 6 || strcmp(argv[1], "--device") != 0
        || (strcmp(argv[3], "usb") != 0 && strcmp(argv[3], "network") != 0)
        || (argc == 6 && (reports == 0 || since_end == argv[5] || *since_end != '\0'))) {
        fprintf(stderr, "Usage: mobile-dev-ios-logs --device <hardware-udid> <usb|network> [executable-name | --crash-reports <since-unix-ms>]\n");
        return 2;
    }
    signal(SIGTERM, stop);
    signal(SIGINT, stop);
    signal(SIGPIPE, stop);
    setvbuf(stdout, NULL, _IOLBF, 0);
    idevice_t device = NULL;
    lockdownd_client_t lockdown = NULL;
    int exit_code = 1;
    enum idevice_options lookup = strcmp(argv[3], "network") == 0 ? IDEVICE_LOOKUP_NETWORK : IDEVICE_LOOKUP_USBMUX;
    idevice_error_t found = idevice_new_with_options(&device, argv[2], lookup);
    if (found != IDEVICE_E_SUCCESS) {
        fprintf(stderr, "The selected iPhone is unavailable to libimobiledevice over %s (%d).\n", argv[3], found);
        goto cleanup;
    }
    lockdownd_error_t paired = lockdownd_client_new_with_handshake(device, &lockdown, "mobile-dev-ios-logs");
    if (paired != LOCKDOWN_E_SUCCESS) {
        const char *description = lockdownd_strerror(paired);
        fprintf(stderr, "Cannot connect to the iPhone: %s. Unlock it and trust this Mac.\n", description);
        goto cleanup;
    }
    if (reports) {
        int moved = move_crash_reports(device, lockdown);
        if (moved == 0 && copy_crash_reports(device, lockdown, since_ms) == 0) exit_code = 0;
    } else {
        const char *filter = argc == 5 ? argv[4] : NULL;
        stream_logs(device, &lockdown, filter, connected_at);
    }
cleanup:
    if (lockdown != NULL) lockdownd_client_free(lockdown);
    if (device != NULL) idevice_free(device);
    if (stopping) exit_code = 0;
    return exit_code;
}
