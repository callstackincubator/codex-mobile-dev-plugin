#ifndef MOBILE_DEV_TELEMETRY_H
#define MOBILE_DEV_TELEMETRY_H

#ifdef __cplusplus
extern "C" {
#endif

enum mobile_dev_timing {
    MOBILE_DEV_CONNECT,
    MOBILE_DEV_FRAME_PROCESS,
    MOBILE_DEV_INPUT,
    MOBILE_DEV_LOG_PROCESS,
    MOBILE_DEV_CPU_SAMPLE,
    MOBILE_DEV_FPS_READ,
    MOBILE_DEV_TIMING_COUNT
};

void mobile_dev_telemetry_init(const char *component);
void mobile_dev_telemetry_close(void);
double mobile_dev_telemetry_now(void);
void mobile_dev_telemetry_timing(enum mobile_dev_timing kind, double duration_ms);
void mobile_dev_telemetry_error(const char *operation, const char *message);
void mobile_dev_telemetry_panic(const char *file, unsigned int line);

#ifdef __cplusplus
}
#endif
#endif
