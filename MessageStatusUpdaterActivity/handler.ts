import { Context } from "@azure/functions";

import * as t from "io-ts";

import { NonEmptyString } from "italia-ts-commons/lib/strings";

import { MessageStatusValue } from "io-functions-commons/dist/generated/definitions/MessageStatusValue";
import {
  getMessageStatusUpdater,
  MessageStatusModel
} from "io-functions-commons/dist/src/models/message_status";
import { ReadableReporter } from "italia-ts-commons/lib/reporters";

const Input = t.interface({
  messageId: NonEmptyString,
  status: MessageStatusValue
});

interface IResponse {
  kind: "FAILURE" | "SUCCESS";
}

export const getMessageStatusUpdaterActivityHandler = (
  messageStatusModel: MessageStatusModel
) => async (context: Context, input: unknown): Promise<IResponse> => {
  const decodedInput = Input.decode(input);
  if (decodedInput.isLeft()) {
    context.log.error(
      `MessageStatusUpdaterActivity|ERROR=${ReadableReporter.report(
        decodedInput
      ).join(" / ")}`
    );
    return { kind: "FAILURE" };
  }

  const { messageId, status } = decodedInput.value;

  const messageStatusUpdater = getMessageStatusUpdater(
    messageStatusModel,
    messageId
  );

  const result = await messageStatusUpdater(status);

  if (result.isLeft()) {
    context.log.error(
      `MessageStatusUpdaterActivity|MESSAGE_ID=${messageId}|STATUS=${status}|ERROR=${result.value.message}`
    );
    throw new Error(result.value.message);
  }

  context.log.verbose(
    `MessageStatusUpdaterActivity|MESSAGE_ID=${messageId}|STATUS=${status}|RESULT=SUCCESS`
  );

  return { kind: "SUCCESS" };
};
