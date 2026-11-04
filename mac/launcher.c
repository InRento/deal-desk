// Deal Desk.app/Contents/MacOS/DealDesk: runs Resources/launcher.sh and waits for it (it returns once the server runs).
// macOS grants access to Google Drive's folder (files managed by another app) to a signed program only, and remembers
// it for that program: a bare shell script as the app's executable never keeps the permission. This signed stub is what
// asks for access; the launcher and the server it starts are attributed to it, and the server keeps the access after
// the app has quit (checked: syncing, reading documents and writing lock files still work).
#include <limits.h>
#include <libgen.h>
#include <mach-o/dyld.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>

extern char **environ;

int main(int argc, char **argv) {
  char exe[PATH_MAX], real[PATH_MAX], script[PATH_MAX + 64];
  uint32_t n = sizeof exe;
  if (_NSGetExecutablePath(exe, &n) != 0 || !realpath(exe, real)) return 1;
  snprintf(script, sizeof script, "%s/../Resources/launcher.sh", dirname(real));
  char *args[argc + 2];
  args[0] = "/bin/bash";
  args[1] = script;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  args[argc + 1] = NULL;
  pid_t pid;
  if (posix_spawn(&pid, "/bin/bash", NULL, NULL, args, environ) != 0) return 1;
  int st;
  while (waitpid(pid, &st, 0) < 0) {}
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
