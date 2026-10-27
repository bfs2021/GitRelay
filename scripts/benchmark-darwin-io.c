#include <sys/resource.h>
#include <sys/wait.h>
#include <mach/mach_time.h>
#include <libproc.h>
#include <errno.h>
#include <stdio.h>
#include <time.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  struct timespec start, end;
  clock_gettime(CLOCK_MONOTONIC, &start);
  pid_t pid = fork();
  if (pid < 0) { perror("fork"); return 2; }
  if (pid == 0) { execvp(argv[1], argv + 1); perror("execvp"); _exit(127); }

  siginfo_t info = {0};
  while (waitid(P_PID, pid, &info, WEXITED | WNOWAIT) < 0) {
    if (errno != EINTR) { perror("waitid"); return 2; }
  }
  struct rusage_info_v4 usage = {0};
  int result = proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&usage);
  int saved = errno;
  int status;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) { perror("waitpid"); return 2; }
  }
  clock_gettime(CLOCK_MONOTONIC, &end);
  if (result != 0) { errno = saved; perror("proc_pid_rusage"); return 2; }
  mach_timebase_info_data_t scale;
  mach_timebase_info(&scale);
  double wall = (end.tv_sec - start.tv_sec) * 1000.0 + (end.tv_nsec - start.tv_nsec) / 1000000.0;
  double factor = (double)scale.numer / scale.denom / 1000000.0;
  fprintf(stderr, "{\"wall_ms\":%.2f,\"user_ms\":%.2f,\"system_ms\":%.2f,\"max_footprint_bytes\":%llu,\"disk_read_bytes\":%llu,\"disk_write_bytes\":%llu,\"logical_write_bytes\":%llu}\n",
    wall, usage.ri_user_time * factor, usage.ri_system_time * factor, usage.ri_lifetime_max_phys_footprint,
    usage.ri_diskio_bytesread, usage.ri_diskio_byteswritten, usage.ri_logical_writes);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
