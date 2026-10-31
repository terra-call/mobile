#import "TerraCallPushKit.h"
#import <PushKit/PushKit.h>
#import <RNCallKeep/RNCallKeep.h>
#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>

@interface TerraCallPushKit () <PKPushRegistryDelegate>
@property(nonatomic, strong) PKPushRegistry *registry;
@end

@implementation TerraCallPushKit

+ (void)start {
  static TerraCallPushKit *instance;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    instance = [TerraCallPushKit new];
    // A provider MUST exist before PushKit delivers a cold-start push.
    [RNCallKeep setup:@{
      @"appName": @"Terra Call",
      @"supportsVideo": @YES,
      @"maximumCallGroups": @1,
      @"maximumCallsPerCallGroup": @1,
      @"includesCallsInRecents": @NO
    }];
    instance.registry = [[PKPushRegistry alloc] initWithQueue:dispatch_get_main_queue()];
    instance.registry.delegate = instance;
    instance.registry.desiredPushTypes = [NSSet setWithObject:PKPushTypeVoIP];
  });
}

- (void)pushRegistry:(PKPushRegistry *)registry
    didUpdatePushCredentials:(PKPushCredentials *)credentials
    forType:(PKPushType)type {
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:type];
}

- (void)pushRegistry:(PKPushRegistry *)registry
    didReceiveIncomingPushWithPayload:(PKPushPayload *)payload
    forType:(PKPushType)type
    withCompletionHandler:(void (^)(void))completion {
  NSDictionary *data = payload.dictionaryPayload;
  NSString *uuid = [data[@"callUUID"] isKindOfClass:NSString.class] ? data[@"callUUID"] : nil;
  if (![[NSUUID alloc] initWithUUIDString:uuid ?: @""]) {
    uuid = NSUUID.UUID.UUIDString;
  }
  // iOS requires reporting EVERY VoIP push to CallKit immediately, before
  // JS, authentication or a Firestore fetch. Never use VoIP pushes to cancel.
  [RNCallKeep reportNewIncomingCall:uuid
                           handle:@"Terra Call"
                       handleType:@"generic"
                         hasVideo:YES
              localizedCallerName:@"Terra Call video call"
                  supportsHolding:NO
                     supportsDTMF:NO
                 supportsGrouping:NO
               supportsUngrouping:NO
                      fromPushKit:YES
                          payload:data
            withCompletionHandler:completion];
  [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:type];

  // The JS bridge can be slow or unavailable. Do not leave a ghost incoming
  // call indefinitely; end unanswered native UI at the server's ring deadline.
  NSTimeInterval expiry = [data[@"expiresAt"] doubleValue] / 1000.0;
  NSTimeInterval delay = MIN(45.0, MAX(0.0, expiry - NSDate.date.timeIntervalSince1970));
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    if (![RNCallKeep isCallActive:uuid]) {
      [RNCallKeep endCallWithUUID:uuid reason:3];
    }
  });
}
@end
