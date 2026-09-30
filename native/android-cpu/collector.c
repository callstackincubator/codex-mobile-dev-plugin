/* CPU-only adaptation of BAM's MIT-licensed Flashlight /proc collector.
 * See LICENSE and README.md in this directory for provenance. */
#define _POSIX_C_SOURCE 200809L
#include <dirent.h>
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define MAX_THREADS 4096
typedef struct { int tid; uint64_t ticks, start; char name[256]; } Counter;
static Counter threads[MAX_THREADS];
static volatile sig_atomic_t stopped;

static void stop(int signal_number) { (void)signal_number; stopped = 1; }

static uint64_t micros(clockid_t clock) {
    struct timespec value;
    if (clock_gettime(clock, &value) != 0) { perror("clock_gettime"); exit(1); }
    return (uint64_t)value.tv_sec * 1000000 + (uint64_t)value.tv_nsec / 1000;
}

/* comm can contain spaces, newlines and parentheses. The final ')' ends it. */
static int parse_stat(char *text, Counter *counter) {
    char *open = strchr(text, '(');
    char *close = strrchr(text, ')');
    if (open == NULL || close == NULL || close <= open) return -1;
    size_t length = (size_t)(close - open - 1);
    if (length >= sizeof(counter->name)) return -1;
    memcpy(counter->name, open + 1, length);
    counter->name[length] = '\0';
    char *cursor = close + 1;
    uint64_t user = 0, system = 0;
    for (int field = 3; field <= 22; field++) {
        while (*cursor == ' ') cursor++;
        if (*cursor == '\0') return -1;
        char *end = strchr(cursor, ' ');
        if (end == NULL) end = cursor + strlen(cursor);
        if (field == 14 || field == 15 || field == 22) {
            errno = 0;
            char *parsed;
            unsigned long long value = strtoull(cursor, &parsed, 10);
            if (errno != 0 || parsed != end || *cursor == '-') return -1;
            if (field == 14) user = value;
            if (field == 15) system = value;
            if (field == 22) counter->start = value;
        }
        cursor = end;
    }
    if (UINT64_MAX - user < system) return -1;
    counter->ticks = user + system;
    return 0;
}

static int read_counter(const char *path, Counter *counter) {
    FILE *file = fopen(path, "r");
    if (file == NULL) return -1;
    char data[4096];
    size_t length = fread(data, 1, sizeof(data) - 1, file);
    int failed = ferror(file) || length == sizeof(data) - 1;
    fclose(file);
    if (failed) { errno = EIO; return -1; }
    data[length] = '\0';
    if (parse_stat(data, counter) != 0) { errno = EINVAL; return -1; }
    return 0;
}

static void json_string(const char *value) {
    putchar('"');
    for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor++) {
        if (*cursor == '"' || *cursor == '\\') { putchar('\\'); putchar(*cursor); }
        else if (*cursor < 32) printf("\\u%04x", *cursor);
        else putchar(*cursor);
    }
    putchar('"');
}

static int failure(const char *operation) {
    int code = errno;
    fprintf(stderr, "Android CPU: %s: %s. ADB shell must be allowed to read this app's /proc counters.\n", operation, strerror(code));
    return 1;
}

#ifndef COLLECTOR_TEST
int main(int argc, char **argv) {
    if (argc != 2) { fprintf(stderr, "Usage: mobile-dev-cpu PID\n"); return 1; }
    char *end;
    long pid = strtol(argv[1], &end, 10);
    if (*end != '\0' || pid <= 0 || pid > INT_MAX) return 1;
    signal(SIGTERM, stop);
    signal(SIGINT, stop);
    /* A closed ADB pipe terminates the collector, without touching the app. */
    signal(SIGPIPE, SIG_DFL);
    char output_buffer[65536];
    setvbuf(stdout, output_buffer, _IOFBF, sizeof(output_buffer));
    char process_path[128], task_path[128];
    snprintf(process_path, sizeof(process_path), "/proc/%ld/stat", pid);
    snprintf(task_path, sizeof(task_path), "/proc/%ld/task", pid);
    Counter process = {0};
    if (read_counter(process_path, &process) != 0) return failure("read process");
    uint64_t birth = process.start;
    long ticks = sysconf(_SC_CLK_TCK);
    if (ticks <= 0) { fprintf(stderr, "Invalid kernel clock rate\n"); return 1; }
    printf("{\"type\":\"ready\",\"pid\":%ld,\"collectorPid\":%d,\"clockTicks\":%ld,\"processStart\":\"%" PRIu64 "\"}\n", pid, getpid(), ticks, birth);
    fflush(stdout);
    while (stopped == 0) {
        uint64_t started = micros(CLOCK_MONOTONIC);
        if (read_counter(process_path, &process) != 0) return failure("read process");
        if (process.start != birth) { fprintf(stderr, "The target process restarted.\n"); return 1; }
        DIR *directory = opendir(task_path);
        if (directory == NULL) return failure("read threads");
        size_t count = 0;
        struct dirent *entry;
        while (1) {
            errno = 0;
            entry = readdir(directory);
            if (entry == NULL) {
                int code = errno;
                closedir(directory);
                if (code != 0) { errno = code; return failure("list threads"); }
                break;
            }
            char *tid_end;
            long tid = strtol(entry->d_name, &tid_end, 10);
            if (*tid_end != '\0' || tid <= 0 || tid > INT_MAX) continue;
            if (count == MAX_THREADS) { closedir(directory); fprintf(stderr, "Too many app threads to monitor.\n"); return 1; }
            char path[160];
            snprintf(path, sizeof(path), "/proc/%ld/task/%ld/stat", pid, tid);
            if (read_counter(path, &threads[count]) != 0) {
                int code = errno;
                if (code == ENOENT || code == ESRCH) continue; /* Thread exited mid-sample. */
                closedir(directory);
                errno = code;
                return failure("read thread");
            }
            threads[count].tid = (int)tid;
            count++;
        }
        uint64_t timestamp = started;
        uint64_t collector_cpu = micros(CLOCK_PROCESS_CPUTIME_ID);
        printf("{\"type\":\"sample\",\"timestampUs\":\"%" PRIu64 "\",\"processStart\":\"%" PRIu64 "\",\"processTicks\":\"%" PRIu64 "\",\"collectorCpuUs\":\"%" PRIu64 "\",\"threads\":[", timestamp, birth, process.ticks, collector_cpu);
        for (size_t index = 0; index < count; index++) {
            Counter *thread = &threads[index];
            if (index != 0) putchar(',');
            printf("{\"tid\":%d,\"start\":\"%" PRIu64 "\",\"ticks\":\"%" PRIu64 "\",\"name\":", thread->tid, thread->start, thread->ticks);
            json_string(thread->name);
            putchar('}');
        }
        puts("]}");
        if (fflush(stdout) != 0) return 1;
        uint64_t now = micros(CLOCK_MONOTONIC);
        uint64_t duration = now - started;
        int timeout = duration < 1000000 ? (int)((1000000 - duration + 999) / 1000) : 0;
        struct pollfd input = { .fd = STDIN_FILENO, .events = POLLIN };
        int ready = poll(&input, 1, timeout);
        if (ready > 0) break; /* Stop command, EOF, or transport disconnect. */
        if (ready < 0 && errno != EINTR) return failure("wait");
    }
    return 0;
}
#endif
