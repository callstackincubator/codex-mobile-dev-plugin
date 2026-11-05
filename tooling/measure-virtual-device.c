#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <time.h>

typedef struct {
  int pid;
  int parent;
  int included;
} Process;

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  const int root = atoi(argv[1]);
  if (root <= 0) return 2;
  const int capacity = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0) + 4096;
  int *pids = calloc(1, capacity);
  Process *processes = calloc(capacity / sizeof(int), sizeof(Process));
  if (pids == NULL || processes == NULL) return 3;
  const int bytes = proc_listpids(PROC_ALL_PIDS, 0, pids, capacity);
  if (bytes <= 0) return 4;
  int count = 0;
  for (int i = 0; i < bytes / (int)sizeof(int); i++) {
    struct proc_bsdinfo info;
    const int size = proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &info, sizeof(info));
    if (size != sizeof(info)) continue;
    processes[count++] = (Process){pids[i], (int)info.pbi_ppid, pids[i] == root};
  }
  int changed;
  do {
    changed = 0;
    for (int i = 0; i < count; i++) {
      if (processes[i].included) continue;
      for (int j = 0; j < count; j++) {
        if (processes[j].included && processes[i].parent == processes[j].pid) {
          processes[i].included = 1;
          changed = 1;
          break;
        }
      }
    }
  } while (changed);
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  const uint64_t time = (uint64_t)now.tv_sec * 1000000000ULL + now.tv_nsec;
  printf("{\"timeNs\":\"%llu\",\"processes\":[", (unsigned long long)time);
  int emitted = 0;
  for (int i = 0; i < count; i++) {
    if (processes[i].included == 0) continue;
    struct rusage_info_v4 usage;
    const int result = proc_pid_rusage(processes[i].pid, RUSAGE_INFO_V4, (rusage_info_t *)&usage);
    if (result != 0) return 5;
    printf("%s{\"pid\":%d,\"start\":\"%llu\",\"cpuNs\":\"%llu\",\"footprintBytes\":%llu}",
      emitted++ ? "," : "", processes[i].pid, (unsigned long long)usage.ri_proc_start_abstime,
      (unsigned long long)(usage.ri_user_time + usage.ri_system_time), (unsigned long long)usage.ri_phys_footprint);
  }
  puts("]}");
  free(processes);
  free(pids);
  return emitted == 0 ? 6 : 0;
}
