#import <Cocoa/Cocoa.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 1;
        pid_t pid = (pid_t)atoi(argv[1]);
        NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID));
        for (NSDictionary *window in windows) {
            if ([window[(id)kCGWindowOwnerPID] intValue] != pid || [window[(id)kCGWindowLayer] intValue] != 0) continue;
            CGRect frame;
            if (!CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)window[(id)kCGWindowBounds], &frame)) continue;
            NSScreen *screen = NSScreen.mainScreen;
            NSRect visible = screen.visibleFrame;
            NSDictionary *result = @{
                @"window": @[@(frame.origin.x), @(frame.origin.y), @(frame.size.width), @(frame.size.height)],
                @"screen": @[@(visible.origin.x), @(NSMaxY(screen.frame) - NSMaxY(visible)), @(visible.size.width), @(visible.size.height)]
            };
            NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
            fwrite(data.bytes, 1, data.length, stdout);
            return 0;
        }
        return 1;
    }
}
