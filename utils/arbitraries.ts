import * as assert from "assert";
import * as fc from "fast-check";
import { some } from "fp-ts/lib/Option";
import { BlockedInboxOrChannelEnum } from "io-functions-commons/dist/generated/definitions/BlockedInboxOrChannel";
import { NewMessage } from "io-functions-commons/dist/generated/definitions/NewMessage";
import { PreferredLanguageEnum } from "io-functions-commons/dist/generated/definitions/PreferredLanguage";
import { NewMessageWithoutContent } from "io-functions-commons/dist/src/models/message";
import { Profile } from "io-functions-commons/dist/src/models/profile";
import { Service } from "io-functions-commons/dist/src/models/service";
import { ClientIp } from "io-functions-commons/dist/src/utils/middlewares/client_ip_middleware";
import {
  NonNegativeNumber,
  WithinRangeInteger
} from "italia-ts-commons/lib/numbers";
import {
  EmailString,
  FiscalCode,
  NonEmptyString,
  PatternString
} from "italia-ts-commons/lib/strings";

//
// custom fastcheck arbitraries
//

const headA = (a: ReadonlyArray<string>) => a[0];
const joinS = (a: ReadonlyArray<string>) => {
  assert.strictEqual(a.length > 0, true);
  return a.join("") as NonEmptyString;
};

export const upperCaseAlphaArb = fc
  .subarray("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), 1, 1)
  .map(headA);

export const alphaStringArb = (len: number) =>
  fc.array(upperCaseAlphaArb, len, len).map(joinS);

const numStringArb = (len: number) =>
  fc.array(fc.nat(9).map(String), len, len).map(joinS);

const fiscalCodeAlphaNumArb = fc
  .subarray("0123456789LMNPQRSTUV".split(""), 1, 1)
  .map(headA);

const fiscalCodeControlAlphaArb = fc
  .subarray("ABCDEHLMPRST".split(""), 1, 1)
  .map(headA);

// generate a fiscal code that matches FiscalCode's regexp
// note that this may not be an actual valid fiscal code as the last
// control digit needs to be calculated while here we just generate
// one randomly.
export const fiscalCodeArb = fc
  .tuple(
    fc.array(upperCaseAlphaArb, 6, 6).map(_ => _.join("")),
    fc.array(fiscalCodeAlphaNumArb, 2, 2).map(_ => _.join("")),
    fiscalCodeControlAlphaArb,
    fc.array(fiscalCodeAlphaNumArb, 2, 2).map(_ => _.join("")),
    upperCaseAlphaArb,
    fc.array(fiscalCodeAlphaNumArb, 3, 3).map(_ => _.join("")),
    upperCaseAlphaArb
  )
  .map(sx => sx.join("") as FiscalCode);

export const fiscalCodeArrayArb = fc.array(fiscalCodeArb);

export const fiscalCodeSetArb = fiscalCodeArrayArb.map(_ => new Set(_));

export const clientIpArb = fc.ipV4().map(_ => some(_) as ClientIp);

const messageContentSubject = fc.string(10, 120);
const messageContentMarkdown = fc.string(80, 10000);

export const newMessageArb = fc
  .tuple(messageContentSubject, messageContentMarkdown)
  .map(([subject, markdown]) =>
    NewMessage.decode({
      content: {
        markdown,
        subject
      }
    }).getOrElse(undefined)
  )
  .filter(_ => _ !== undefined);

export const newMessageWithDefaultEmailArb = fc
  .tuple(newMessageArb, fc.emailAddress())
  .map(([m, email]) => ({
    ...m,
    default_addresses: {
      email: email as EmailString
    }
  }));

export const messageTimeToLiveArb = fc
  .integer(3600, 604800)
  // tslint:disable-next-line:no-useless-cast
  .map(_ => _ as number & WithinRangeInteger<3600, 604800>);

export const amountArb = fc
  .integer(1, 9999999999)
  .map(_ =>
    WithinRangeInteger(1, 9999999999)
      .decode(_)
      .getOrElse(undefined)
  )
  .filter(_ => _ !== undefined);

export const maxAmountArb = fc
  .integer(0, 9999999999)
  // tslint:disable-next-line:no-useless-cast
  .map(_ => _ as number & WithinRangeInteger<0, 9999999999>);

export const noticeNumberArb = fc
  .tuple(
    fc.subarray("0123".split(""), 1, 1).map(_ => _.join("")),
    fc
      .array(fc.subarray("0123456789".split(""), 1, 1), 17, 17)
      .map(_ => _.join(""))
  )
  .map(_ => _.join("") as string & PatternString<"^[0123][0-9]{17}$">);

export const paymentDataArb = fc
  .tuple(amountArb, noticeNumberArb)
  .map(([amount, noticeNumber]) => ({
    amount,
    notice_number: noticeNumber
  }));

export const newMessageWithPaymentDataArb = fc
  .tuple(newMessageArb, paymentDataArb)
  .map(([m, paymentData]) => ({
    ...m,
    content: {
      ...m.content,
      payment_data: paymentData
    }
  }));

export const newMessageWithoutContentArb = fc
  .tuple(
    fiscalCodeArb,
    alphaStringArb(8),
    alphaStringArb(8),
    messageTimeToLiveArb,
    fc.nat(),
    alphaStringArb(8)
  )
  .map(
    ([
      fiscalCode,
      senderServiceId,
      senderUserId,
      timeToLiveSeconds,
      createdAtEpoc,
      messageId
    ]) =>
      ({
        createdAt: new Date(createdAtEpoc),
        fiscalCode,
        id: messageId,
        indexedId: messageId,
        kind: "INewMessageWithoutContent",
        senderServiceId,
        senderUserId,
        timeToLiveSeconds
      } as NewMessageWithoutContent)
  );

export const serviceArb = fc
  .tuple(
    fiscalCodeSetArb,
    alphaStringArb(8),
    fc.boolean(),
    maxAmountArb,
    numStringArb(11),
    fc.lorem(),
    fc.boolean(),
    alphaStringArb(8),
    fc.lorem()
  )
  .map(
    ([
      authorizedRecipients,
      departmentName,
      isVisible,
      maxAllowedPaymentAmount,
      organizationFiscalCode,
      organizationName,
      requireSecureChannels,
      serviceId,
      serviceName
    ]) =>
      ({
        authorizedCIDRs: new Set(),
        authorizedRecipients,
        departmentName,
        isVisible,
        maxAllowedPaymentAmount,
        organizationFiscalCode: (organizationFiscalCode as unknown) as string &
          PatternString<"^[0-9]{11}$">,
        organizationName: organizationName as NonEmptyString,
        requireSecureChannels,
        serviceId,
        serviceName: serviceName as NonEmptyString
      } as Service)
  );

export const versionedServiceArb = fc
  .tuple(serviceArb, fc.nat())
  .map(([service, version]) => ({
    ...service,
    version: version as NonNegativeNumber
  }));

export const profileArb = fc.tuple(fiscalCodeArb, fc.emailAddress()).map(
  ([fiscalCode, email]) =>
    ({
      blockedInboxOrChannels: {
        "01234567890": new Set([BlockedInboxOrChannelEnum.INBOX])
      },
      email: email as EmailString,
      fiscalCode,
      preferredLanguages: [PreferredLanguageEnum.en_GB]
    } as Profile)
);
