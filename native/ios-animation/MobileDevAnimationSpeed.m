// Loaded into an iOS simulator app that App Flow launches. Scales Core
// Animation time in the app's windows while a capture run asks for it, so
// sheets and transitions settle sooner. Final layouts are unchanged.
//
// It starts at the speed in MOBILE_DEV_ANIMATION_SPEED from the launch
// environment. A run changes it through the state of a simulator notification,
// in hundredths: 100 is normal speed and 1000 is ten times faster. An unset
// state keeps the current speed; the simulator drops a state once no process
// holds its name. The library records the process that loaded it under the
// app's bundle identifier, so the host can tell whether the running app needs a
// relaunch. It reads no app data.
#import <UIKit/UIKit.h>
#include <notify.h>
#include <stdlib.h>
#include <unistd.h>

static const char *const speedName = "dev.mobile-dev.app-flow.animation-speed";
static NSString *const loadedPrefix = @"dev.mobile-dev.app-flow.animation-library.";
static float currentSpeed = 1;

static void applySpeed(UIWindow *window) {
  if ([window isKindOfClass:[UIWindow class]] && window.layer.speed != currentSpeed) window.layer.speed = currentSpeed;
}

static void applyAll(void) {
  NSMutableSet<UIWindow *> *windows = [NSMutableSet set];
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if ([scene isKindOfClass:[UIWindowScene class]]) [windows addObjectsFromArray:((UIWindowScene *)scene).windows];
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  [windows addObjectsFromArray:UIApplication.sharedApplication.windows];
#pragma clang diagnostic pop
  for (UIWindow *window in windows) applySpeed(window);
}

static void readSpeed(int token) {
  uint64_t state = 0;
  if (notify_get_state(token, &state) != NOTIFY_STATUS_OK || state < 100 || state > 2000) return;
  float speed = state / 100.0f;
  if (speed == currentSpeed) return;
  currentSpeed = speed;
  applyAll();
}

__attribute__((constructor)) static void install(void) {
  const char *initial = getenv("MOBILE_DEV_ANIMATION_SPEED");
  float speed = initial ? strtof(initial, NULL) : 1;
  if (speed >= 1 && speed <= 20) currentSpeed = speed;
  NSString *bundle = NSBundle.mainBundle.bundleIdentifier;
  int loaded;
  if (bundle.length && notify_register_check([loadedPrefix stringByAppendingString:bundle].UTF8String, &loaded) == NOTIFY_STATUS_OK) {
    notify_set_state(loaded, (uint64_t)getpid());
  }
  int token;
  if (notify_register_dispatch(speedName, &token, dispatch_get_main_queue(), ^(int changed) { readSpeed(changed); }) == NOTIFY_STATUS_OK) {
    dispatch_async(dispatch_get_main_queue(), ^{ readSpeed(token); });
  }
  [[NSNotificationCenter defaultCenter] addObserverForName:UIWindowDidBecomeVisibleNotification object:nil queue:nil
                                                usingBlock:^(NSNotification *note) { applySpeed(note.object); }];
}
