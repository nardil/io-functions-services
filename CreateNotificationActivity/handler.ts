import * as util from "util";

import { Context } from "@azure/functions";

import * as t from "io-ts";

import { isLeft } from "fp-ts/lib/Either";
import { fromNullable, none, Option, some } from "fp-ts/lib/Option";

import { readableReport } from "italia-ts-commons/lib/reporters";

import { BlockedInboxOrChannelEnum } from "io-functions-commons/dist/generated/definitions/BlockedInboxOrChannel";
import { HttpsUrl } from "io-functions-commons/dist/generated/definitions/HttpsUrl";
import { MessageContent } from "io-functions-commons/dist/generated/definitions/MessageContent";
import { NotificationChannelEnum } from "io-functions-commons/dist/generated/definitions/NotificationChannel";
import { CreatedMessageEvent } from "io-functions-commons/dist/src/models/created_message_event";
import { CreatedMessageEventSenderMetadata } from "io-functions-commons/dist/src/models/created_message_sender_metadata";
import { NewMessageWithoutContent } from "io-functions-commons/dist/src/models/message";
import {
  createNewNotification,
  NewNotification,
  NotificationAddressSourceEnum,
  NotificationChannelEmail,
  NotificationModel
} from "io-functions-commons/dist/src/models/notification";
import { NotificationEvent } from "io-functions-commons/dist/src/models/notification_event";
import { RetrievedProfile } from "io-functions-commons/dist/src/models/profile";
import {
  newSenderService,
  SenderServiceModel
} from "io-functions-commons/dist/src/models/sender_service";
import { ulidGenerator } from "io-functions-commons/dist/src/utils/strings";

import { SuccessfulStoreMessageContentActivityResult } from "../StoreMessageContentActivity/handler";

/**
 * Attempt to resolve an email address from
 * the recipient profile.
 */
const getEmailAddressFromProfile = (
  profile: RetrievedProfile
): Option<NotificationChannelEmail> =>
  fromNullable(profile.email).map(email => ({
    addressSource: NotificationAddressSourceEnum.PROFILE_ADDRESS,
    toAddress: email
  }));

/**
 * Try to create (save) a new notification
 */
async function createNotification(
  lNotificationModel: NotificationModel,
  senderMetadata: CreatedMessageEventSenderMetadata,
  newMessageWithoutContent: NewMessageWithoutContent,
  newMessageContent: MessageContent,
  newNotification: NewNotification
): Promise<NotificationEvent> {
  const errorOrNotification = await lNotificationModel.create(
    newNotification,
    newNotification.messageId
  );

  if (isLeft(errorOrNotification)) {
    throw new Error(
      `Cannot save notification to database: ${errorOrNotification.value}`
    );
  }

  const notification = errorOrNotification.value;

  return {
    content: newMessageContent,
    message: newMessageWithoutContent,
    notificationId: notification.id,
    senderMetadata
  };
}

export const CreateNotificationActivityInput = t.interface({
  createdMessageEvent: CreatedMessageEvent,
  storeMessageContentActivityResult: SuccessfulStoreMessageContentActivityResult
});

export type CreateNotificationActivityInput = t.TypeOf<
  typeof CreateNotificationActivityInput
>;

const CreateNotificationActivitySomeResult = t.interface({
  hasEmail: t.boolean,
  hasWebhook: t.boolean,
  kind: t.literal("some"),
  notificationEvent: NotificationEvent
});

type CreateNotificationActivitySomeResult = t.TypeOf<
  typeof CreateNotificationActivitySomeResult
>;

const CreateNotificationActivityNoneResult = t.interface({
  kind: t.literal("none")
});

type CreateNotificationActivityNoneResult = t.TypeOf<
  typeof CreateNotificationActivityNoneResult
>;

export const CreateNotificationActivityResult = t.taggedUnion("kind", [
  CreateNotificationActivitySomeResult,
  CreateNotificationActivityNoneResult
]);

export type CreateNotificationActivityResult = t.TypeOf<
  typeof CreateNotificationActivityResult
>;

/**
 * Returns a function for handling createNotificationActivity
 */
export const getCreateNotificationActivityHandler = (
  lSenderServiceModel: SenderServiceModel,
  lNotificationModel: NotificationModel,
  lDefaultWebhookUrl: HttpsUrl
) => async (context: Context, input: unknown): Promise<unknown> => {
  const inputOrError = CreateNotificationActivityInput.decode(input);
  if (inputOrError.isLeft()) {
    context.log.error(
      `CreateNotificationActivity|Unable to parse CreateNotificationActivityHandlerInput|ERROR=${readableReport(
        inputOrError.value
      )}`
    );
    return CreateNotificationActivityResult.encode({
      kind: "none"
    });
  }

  const {
    createdMessageEvent,
    storeMessageContentActivityResult
  } = inputOrError.value;

  const logPrefix = `CreateNotificationActivity|MESSAGE_ID=${createdMessageEvent.message.id}|RECIPIENT=${createdMessageEvent.message.fiscalCode}`;

  context.log.verbose(`${logPrefix}|STARTING`);

  const {
    senderMetadata,
    message: newMessageWithoutContent
  } = createdMessageEvent;
  const { blockedInboxOrChannels, profile } = storeMessageContentActivityResult;

  //
  // Decide whether to send an email notification
  //

  // whether email notifications are enabled in this user profile - this is
  // true by default, it's false only for users that have isEmailEnabled = false
  // in their profile
  const isEmailEnabledInProfile = profile.isEmailEnabled;

  // first we check whether the user has blocked emails notifications for the
  // service that is sending the message
  const isEmailBlockedForService =
    blockedInboxOrChannels.indexOf(BlockedInboxOrChannelEnum.EMAIL) >= 0;

  // then we retrieve the optional email from the user profile
  const maybeEmailFromProfile = getEmailAddressFromProfile(profile);

  // the sender service allows email channel
  const isEmailChannelAllowed = !senderMetadata.requireSecureChannels;

  // finally we decide whether we should send the email notification or not -
  // we send an email notification when all the following conditions are met:
  //
  // * email notifications are enabled in the user profile (isEmailEnabledInProfile)
  // * email notifications are not blocked for the sender service (!isEmailBlockedForService)
  // * the sender service allows email channel
  // * a destination email address is configured (maybeEmailFromProfile)
  //
  const maybeEmailNotificationAddress =
    isEmailEnabledInProfile &&
    !isEmailBlockedForService &&
    isEmailChannelAllowed
      ? maybeEmailFromProfile
      : none;

  context.log.verbose(
    `${logPrefix}|CHANNEL=EMAIL|PROFILE_ENABLED=${isEmailEnabledInProfile}|SERVICE_BLOCKED=${isEmailBlockedForService}|PROFILE_EMAIL=${maybeEmailFromProfile.isSome()}|WILL_NOTIFY=${maybeEmailNotificationAddress.isSome()}`
  );

  //
  //  Decide whether to send a webhook notification
  //

  // whether the recipient wants us to send notifications to the app backend
  const isWebhookEnabledInProfile = profile.isWebhookEnabled === true;

  // check if the user has blocked webhook notifications sent from this service
  const isWebhookBlockedForService =
    blockedInboxOrChannels.indexOf(BlockedInboxOrChannelEnum.WEBHOOK) >= 0;

  // finally we decide whether we should send the webhook notification or not -
  // we send a webhook notification when all the following conditions are met:
  //
  // * webhook notifications are enabled in the user profile (isWebhookEnabledInProfile)
  // * webhook notifications are not blocked for the sender service (!isWebhookBlockedForService)
  //
  const maybeWebhookNotificationUrl =
    isWebhookEnabledInProfile && !isWebhookBlockedForService
      ? some({
          url: lDefaultWebhookUrl
        })
      : none;

  context.log.verbose(
    `${logPrefix}|CHANNEL=WEBHOOK|CHANNEL_ENABLED=${isWebhookEnabledInProfile}|SERVICE_BLOCKED=${isWebhookBlockedForService}|WILL_NOTIFY=${maybeWebhookNotificationUrl.isSome()}`
  );

  //
  // Record that the sender service has sent a message to the user
  //

  const errorOrSenderService = await lSenderServiceModel.createOrUpdate(
    newSenderService(
      newMessageWithoutContent.fiscalCode,
      newMessageWithoutContent.senderServiceId,
      createdMessageEvent.serviceVersion
    ),
    // partition key
    newMessageWithoutContent.fiscalCode
  );

  if (isLeft(errorOrSenderService)) {
    context.log.error(`${logPrefix}|ERROR=${errorOrSenderService.value.body}`);
    throw new Error(
      `Cannot save sender service id: ${errorOrSenderService.value.body}`
    );
  }

  //
  // If we can't send any notification there's not point in creating a
  // Notification object
  //

  const noChannelsConfigured =
    maybeEmailNotificationAddress.isNone() &&
    maybeWebhookNotificationUrl.isNone();

  if (noChannelsConfigured) {
    context.log.warn(`${logPrefix}|RESULT=NO_CHANNELS_ENABLED`);
    // return no notifications
    return { kind: "none" };
  }

  //
  // Create a Notification object to track the status of each notification
  //

  const newNotification: NewNotification = {
    ...createNewNotification(
      ulidGenerator,
      newMessageWithoutContent.fiscalCode,
      newMessageWithoutContent.id
    ),
    channels: {
      [NotificationChannelEnum.EMAIL]: maybeEmailNotificationAddress.toUndefined(),
      [NotificationChannelEnum.WEBHOOK]: maybeWebhookNotificationUrl.toUndefined()
    }
  };

  const notificationEvent = await createNotification(
    lNotificationModel,
    senderMetadata,
    newMessageWithoutContent,
    createdMessageEvent.content,
    newNotification
  );

  context.log.verbose(`${logPrefix}|RESULT=SUCCESS`);

  context.log.verbose(util.inspect(notificationEvent));

  // Return the notification event to the orchestrator
  // The orchestrato will then run the actual notification activities
  return CreateNotificationActivityResult.encode({
    hasEmail: maybeEmailNotificationAddress.isSome(),
    hasWebhook: maybeWebhookNotificationUrl.isSome(),
    kind: "some",
    notificationEvent
  });
};
