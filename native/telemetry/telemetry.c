#define _POSIX_C_SOURCE 200809L
#include "telemetry.h"
#include <sentry.h>
#include <errno.h>
#include <math.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach/mach.h>
#endif

#ifndef MOBILE_DEV_NATIVE_DSN
#define MOBILE_DEV_NATIVE_DSN "https://1deeefda39022a67df902c638dcf3c8f@o4512180958068736.ingest.de.sentry.io/4512181036318800"
#endif

#define WINDOW_CAPACITY 256
static const char *timing_names[MOBILE_DEV_TIMING_COUNT] = {
    "native.connect", "native.frame.process", "native.input.acknowledge",
    "native.logs.process", "native.cpu.sample", "native.fps.read"
};
typedef struct {
    uint64_t count;
    double sum, maximum, samples[WINDOW_CAPACITY];
    size_t length;
} timing_window;
static timing_window windows[MOBILE_DEV_TIMING_COUNT];
static uint64_t random_state = 0x91879509;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t changed = PTHREAD_COND_INITIALIZER;
static pthread_t sampler;
static int sampler_started, stopping;
static atomic_int enabled;
static double previous_cpu, previous_time, started_at;

double mobile_dev_telemetry_now(void) {
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) return 0;
    return (double)value.tv_sec * 1000.0 + (double)value.tv_nsec / 1000000.0;
}

static const char *filename(const char *path) {
    const char *slash = strrchr(path, '/');
    return slash == NULL ? path : slash + 1;
}

static void basename_field(sentry_value_t object, const char *key) {
    sentry_value_t field = sentry_value_get_by_key(object, key);
    if (sentry_value_get_type(field) != SENTRY_VALUE_TYPE_STRING) return;
    const char *path = sentry_value_as_string(field);
    const char *name = filename(path);
    sentry_value_t replacement = sentry_value_new_string(name);
    sentry_value_set_by_key(object, key, replacement);
}

static void scrub_stack(sentry_value_t object) {
    sentry_value_t stack = sentry_value_get_by_key(object, "stacktrace");
    sentry_value_t frames = sentry_value_get_by_key(stack, "frames");
    size_t length = sentry_value_get_length(frames);
    for (size_t index = 0; index < length; index++) {
        sentry_value_t frame = sentry_value_get_by_index(frames, index);
        for (size_t field = 0; field < 3; field++) {
            static const char *paths[] = { "abs_path", "filename", "package" };
            basename_field(frame, paths[field]);
        }
        sentry_value_remove_by_key(frame, "vars");
        sentry_value_remove_by_key(frame, "pre_context");
        sentry_value_remove_by_key(frame, "context_line");
        sentry_value_remove_by_key(frame, "post_context");
    }
}

static sentry_value_t scrub_event(sentry_value_t event, sentry_hint_t *hint, void *state) {
    (void)hint;
    (void)state;
    const char *fields[] = { "user", "request", "extra", "server_name", "breadcrumbs", "modules" };
    for (size_t index = 0; index < sizeof(fields) / sizeof(fields[0]); index++) {
        sentry_value_remove_by_key(event, fields[index]);
    }
    sentry_value_t contexts = sentry_value_get_by_key(event, "contexts");
    sentry_value_remove_by_key(contexts, "device");
    sentry_value_remove_by_key(contexts, "app");
    sentry_value_t debug = sentry_value_get_by_key(event, "debug_meta");
    sentry_value_t images = sentry_value_get_by_key(debug, "images");
    sentry_value_t safe_images = sentry_value_new_list();
    size_t image_count = sentry_value_get_length(images);
    for (size_t index = 0; index < image_count; index++) {
        sentry_value_t image = sentry_value_get_by_index(images, index);
        sentry_value_t safe_image = sentry_value_new_object();
        const char *keys[] = { "type", "code_file", "debug_file", "debug_id", "code_id",
            "image_addr", "image_size", "image_vmaddr", "arch" };
        for (size_t key = 0; key < sizeof(keys) / sizeof(keys[0]); key++) {
            sentry_value_t field = sentry_value_get_by_key(image, keys[key]);
            sentry_value_incref(field);
            sentry_value_set_by_key(safe_image, keys[key], field);
        }
        basename_field(safe_image, "code_file");
        basename_field(safe_image, "debug_file");
        sentry_value_append(safe_images, safe_image);
    }
    sentry_value_t safe_debug = sentry_value_new_object();
    sentry_value_set_by_key(safe_debug, "images", safe_images);
    sentry_value_set_by_key(event, "debug_meta", safe_debug);
    const char *collections[] = { "exception", "threads" };
    for (size_t index = 0; index < 2; index++) {
        sentry_value_t collection = sentry_value_get_by_key(event, collections[index]);
        sentry_value_t values = sentry_value_get_by_key(collection, "values");
        size_t length = sentry_value_get_length(values);
        for (size_t value = 0; value < length; value++) {
            sentry_value_t object = sentry_value_get_by_index(values, value);
            scrub_stack(object);
        }
    }
    return event;
}

static void attribute(const char *key, const char *text) {
    sentry_set_tag(key, text);
    sentry_value_t value = sentry_value_new_string(text);
    sentry_value_t item = sentry_value_new_attribute(value, NULL);
    sentry_set_attribute(key, item);
}

#if defined(__ANDROID__) || defined(MOBILE_DEV_TELEMETRY_RELAY)
static pthread_mutex_t transport_lock = PTHREAD_MUTEX_INITIALIZER;
static void relay_envelope(sentry_envelope_t *envelope, void *state) {
    (void)state;
    size_t size = 0;
    char *bytes = sentry_envelope_serialize(envelope, &size);
    const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (bytes != NULL && size <= 256 * 1024) {
        size_t length = ((size + 2) / 3) * 4;
        const char prefix[] = "[mobile-dev:sentry-envelope]";
        size_t prefix_length = sizeof(prefix) - 1;
        char *line = malloc(prefix_length + length + 1);
        if (line != NULL) {
            memcpy(line, prefix, prefix_length);
            size_t output = prefix_length;
            for (size_t input = 0; input < size; input += 3) {
                uint32_t value = (uint32_t)(unsigned char)bytes[input] << 16;
                if (input + 1 < size) value |= (uint32_t)(unsigned char)bytes[input + 1] << 8;
                if (input + 2 < size) value |= (unsigned char)bytes[input + 2];
                line[output++] = alphabet[(value >> 18) & 63];
                line[output++] = alphabet[(value >> 12) & 63];
                line[output++] = input + 1 < size ? alphabet[(value >> 6) & 63] : '=';
                line[output++] = input + 2 < size ? alphabet[value & 63] : '=';
            }
            line[output++] = '\n';
            pthread_mutex_lock(&transport_lock);
            size_t written = 0;
            while (written < output) {
                ssize_t count = write(STDERR_FILENO, line + written, output - written);
                if (count < 0 && errno == EINTR) continue;
                if (count <= 0) break;
                written += (size_t)count;
            }
            pthread_mutex_unlock(&transport_lock);
            free(line);
        }
    }
    sentry_free(bytes);
    sentry_envelope_free(envelope);
}
#endif

void mobile_dev_telemetry_timing(enum mobile_dev_timing kind, double duration_ms) {
    if (atomic_load(&enabled) == 0 || kind < 0 || kind >= MOBILE_DEV_TIMING_COUNT
        || isfinite(duration_ms) == 0 || duration_ms < 0) return;
    pthread_mutex_lock(&lock);
    timing_window *window = &windows[kind];
    window->count++;
    window->sum += duration_ms;
    if (duration_ms > window->maximum) window->maximum = duration_ms;
    if (window->length < WINDOW_CAPACITY) window->samples[window->length++] = duration_ms;
    else {
        random_state ^= random_state << 13;
        random_state ^= random_state >> 7;
        random_state ^= random_state << 17;
        uint64_t slot = random_state % window->count;
        if (slot < WINDOW_CAPACITY) window->samples[slot] = duration_ms;
    }
    pthread_mutex_unlock(&lock);
}

static int compare_sample(const void *left, const void *right) {
    double a = *(const double *)left, b = *(const double *)right;
    return a < b ? -1 : a > b ? 1 : 0;
}

static void gauge(const char *name, double value, const char *unit) {
    sentry_value_t attributes = sentry_value_new_null();
    sentry_metrics_gauge(name, value, unit, attributes);
}

static void flush_measurements(void) {
    timing_window snapshot[MOBILE_DEV_TIMING_COUNT];
    pthread_mutex_lock(&lock);
    memcpy(snapshot, windows, sizeof(snapshot));
    memset(windows, 0, sizeof(windows));
    pthread_mutex_unlock(&lock);
    for (size_t index = 0; index < MOBILE_DEV_TIMING_COUNT; index++) {
        timing_window *window = &snapshot[index];
        if (window->count == 0) continue;
        char name[96];
        snprintf(name, sizeof(name), "%s.samples", timing_names[index]);
        sentry_value_t attributes = sentry_value_new_null();
        sentry_metrics_count(name, (int64_t)window->count, attributes);
        snprintf(name, sizeof(name), "%s.mean", timing_names[index]);
        double mean = window->sum / (double)window->count;
        gauge(name, mean, SENTRY_UNIT_MILLISECOND);
        snprintf(name, sizeof(name), "%s.max", timing_names[index]);
        gauge(name, window->maximum, SENTRY_UNIT_MILLISECOND);
        qsort(window->samples, window->length, sizeof(double), compare_sample);
        size_t percentile = (window->length * 95 + 99) / 100 - 1;
        snprintf(name, sizeof(name), "%s.p95", timing_names[index]);
        gauge(name, window->samples[percentile], SENTRY_UNIT_MILLISECOND);
    }
    struct rusage usage;
    double now = mobile_dev_telemetry_now();
    if (getrusage(RUSAGE_SELF, &usage) == 0) {
        double cpu = (double)usage.ru_utime.tv_sec + (double)usage.ru_utime.tv_usec / 1000000.0
            + (double)usage.ru_stime.tv_sec + (double)usage.ru_stime.tv_usec / 1000000.0;
        if (previous_time > 0 && now > previous_time) {
            double utilization = (cpu - previous_cpu) * 1000.0 / (now - previous_time);
            gauge("native.cpu.utilization", utilization, SENTRY_UNIT_RATIO);
        }
        previous_cpu = cpu;
        previous_time = now;
    }
#ifdef __APPLE__
    struct mach_task_basic_info info;
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    mach_port_t task = mach_task_self();
    kern_return_t result = task_info(task, MACH_TASK_BASIC_INFO, (task_info_t)&info, &count);
    if (result == KERN_SUCCESS) gauge("native.memory.rss", (double)info.resident_size, SENTRY_UNIT_BYTE);
#else
    FILE *memory = fopen("/proc/self/statm", "r");
    if (memory != NULL) {
        unsigned long total, resident;
        int read = fscanf(memory, "%lu %lu", &total, &resident);
        fclose(memory);
        long page_size = sysconf(_SC_PAGESIZE);
        if (read == 2 && page_size > 0) {
            double rss = (double)resident * (double)page_size;
            gauge("native.memory.rss", rss, SENTRY_UNIT_BYTE);
        }
    }
#endif
    double uptime = (now - started_at) / 1000.0;
    gauge("native.process.uptime", uptime, SENTRY_UNIT_SECOND);
}

static void *sample_resources(void *state) {
    (void)state;
    pthread_mutex_lock(&lock);
    while (stopping == 0) {
        struct timespec deadline;
        clock_gettime(CLOCK_REALTIME, &deadline);
        deadline.tv_sec += 30;
        int result = 0;
        while (stopping == 0 && result != ETIMEDOUT) result = pthread_cond_timedwait(&changed, &lock, &deadline);
        if (stopping) break;
        pthread_mutex_unlock(&lock);
        flush_measurements();
        pthread_mutex_lock(&lock);
    }
    pthread_mutex_unlock(&lock);
    return NULL;
}

void mobile_dev_telemetry_close(void) {
    if (atomic_exchange(&enabled, 0) == 0) return;
    pthread_mutex_lock(&lock);
    stopping = 1;
    pthread_cond_signal(&changed);
    pthread_mutex_unlock(&lock);
    if (sampler_started) pthread_join(sampler, NULL);
    flush_measurements();
    sentry_close();
}

void mobile_dev_telemetry_init(const char *component) {
    const char *switch_value = getenv("MOBILE_DEV_TELEMETRY");
    if (switch_value != NULL && strcmp(switch_value, "off") == 0) return;
    const char *release = getenv("MOBILE_DEV_NATIVE_RELEASE");
    const char *environment = getenv("MOBILE_DEV_NATIVE_ENVIRONMENT");
    if (release == NULL || environment == NULL) return;
    if (strcmp(environment, "development") != 0 && strcmp(environment, "release") != 0) return;
    const char *cache = getenv("MOBILE_DEV_NATIVE_CACHE");
#ifdef __ANDROID__
    cache = "/data/local/tmp/mobile-dev-sentry";
#endif
    if (cache == NULL) return;
    if (mkdir(cache, 0700) != 0 && errno != EEXIST) return;
    char database[4096];
    int length = snprintf(database, sizeof(database), "%s/%s", cache, component);
    if (length <= 0 || (size_t)length >= sizeof(database)) return;
    sentry_options_t *options = sentry_options_new();
    sentry_options_set_dsn(options, MOBILE_DEV_NATIVE_DSN);
    sentry_options_set_release(options, release);
    sentry_options_set_environment(options, environment);
    sentry_options_set_database_path(options, database);
    sentry_options_set_before_send(options, scrub_event, NULL);
    sentry_options_set_auto_session_tracking(options, 0);
    sentry_options_set_max_breadcrumbs(options, 0);
    sentry_options_set_shutdown_timeout(options, 2000);
#if defined(__ANDROID__) || defined(MOBILE_DEV_TELEMETRY_RELAY)
    sentry_transport_t *transport = sentry_transport_new(relay_envelope);
    sentry_options_set_transport(options, transport);
#endif
    if (sentry_init(options) != 0) {
        fprintf(stderr, "[mobile-dev:sentry] Native telemetry could not initialize.\n");
        return;
    }
    attribute("component", component);
#ifdef __ANDROID__
    attribute("runtime_platform", "android");
#else
    attribute("runtime_platform", "macos");
#endif
    const char *surface = strcmp(component, "ios-logs") == 0 ? "logs"
        : strcmp(component, "ios-fps") == 0 || strcmp(component, "android-fps") == 0 || strcmp(component, "android-cpu") == 0
        ? "performance" : "simulator";
    attribute("surface", surface);
    stopping = 0;
    started_at = mobile_dev_telemetry_now();
    atomic_store(&enabled, 1);
    flush_measurements();
    sampler_started = pthread_create(&sampler, NULL, sample_resources, NULL) == 0;
    atexit(mobile_dev_telemetry_close);
}

void mobile_dev_telemetry_error(const char *operation, const char *message) {
    if (atomic_load(&enabled) == 0) return;
    sentry_value_t event = sentry_value_new_event();
    sentry_value_t exception = sentry_value_new_exception("NativeError", message);
    sentry_value_set_stacktrace(exception, NULL, 0);
    sentry_event_add_exception(event, exception);
    sentry_value_t tags = sentry_value_new_object();
    sentry_value_t name = sentry_value_new_string(operation);
    sentry_value_set_by_key(tags, "operation", name);
    sentry_value_set_by_key(event, "tags", tags);
    sentry_capture_event(event);
}

void mobile_dev_telemetry_panic(const char *file, unsigned int line) {
    if (atomic_load(&enabled) == 0) return;
    sentry_value_t event = sentry_value_new_event();
    sentry_value_t exception = sentry_value_new_exception("RustPanic", "A native Rust task panicked.");
    sentry_value_set_stacktrace(exception, NULL, 0);
    sentry_event_add_exception(event, exception);
    sentry_value_t tags = sentry_value_new_object();
    const char *basename = filename(file);
    sentry_value_t source = sentry_value_new_string(basename);
    sentry_value_set_by_key(tags, "source_file", source);
    sentry_value_set_by_key(event, "tags", tags);
    sentry_value_t contexts = sentry_value_new_object();
    sentry_value_t source_context = sentry_value_new_object();
    sentry_value_t number = sentry_value_new_int32((int32_t)line);
    sentry_value_set_by_key(source_context, "line", number);
    sentry_value_set_by_key(contexts, "native_source", source_context);
    sentry_value_set_by_key(event, "contexts", contexts);
    sentry_capture_event(event);
}
