import { Context } from "@azure/functions";
import { createBlobService } from "azure-storage";

import * as cors from "cors";
import * as express from "express";
import * as winston from "winston";

import { DocumentClient as DocumentDBClient } from "documentdb";

import {
  MESSAGE_COLLECTION_NAME,
  MessageModel
} from "io-functions-commons/dist/src/models/message";
import {
  SERVICE_COLLECTION_NAME,
  ServiceModel
} from "io-functions-commons/dist/src/models/service";
import * as documentDbUtils from "io-functions-commons/dist/src/utils/documentdb";
import { getRequiredStringEnv } from "io-functions-commons/dist/src/utils/env";
import { secureExpressApp } from "io-functions-commons/dist/src/utils/express";
import { AzureContextTransport } from "io-functions-commons/dist/src/utils/logging";
import { setAppContext } from "io-functions-commons/dist/src/utils/middlewares/context_middleware";

import createAzureFunctionHandler from "io-functions-express/dist/src/createAzureFunctionsHandler";

import {
  MESSAGE_STATUS_COLLECTION_NAME,
  MessageStatusModel
} from "io-functions-commons/dist/src/models/message_status";
import {
  NOTIFICATION_COLLECTION_NAME,
  NotificationModel
} from "io-functions-commons/dist/src/models/notification";
import {
  NOTIFICATION_STATUS_COLLECTION_NAME,
  NotificationStatusModel
} from "io-functions-commons/dist/src/models/notification_status";

import { GetMessage } from "./handler";

// Setup Express
const app = express();
secureExpressApp(app);

// Set up CORS (free access to the API from browser clients)
app.use(cors());

const cosmosDbUri = getRequiredStringEnv("CUSTOMCONNSTR_COSMOSDB_URI");
const cosmosDbKey = getRequiredStringEnv("CUSTOMCONNSTR_COSMOSDB_KEY");
const cosmosDbName = getRequiredStringEnv("COSMOSDB_NAME");
const messageContainerName = getRequiredStringEnv("MESSAGE_CONTAINER_NAME");

const documentDbDatabaseUrl = documentDbUtils.getDatabaseUri(cosmosDbName);
const messagesCollectionUrl = documentDbUtils.getCollectionUri(
  documentDbDatabaseUrl,
  MESSAGE_COLLECTION_NAME
);
const servicesCollectionUrl = documentDbUtils.getCollectionUri(
  documentDbDatabaseUrl,
  SERVICE_COLLECTION_NAME
);
const messageStatusCollectionUrl = documentDbUtils.getCollectionUri(
  documentDbDatabaseUrl,
  MESSAGE_STATUS_COLLECTION_NAME
);
const notificationsCollectionUrl = documentDbUtils.getCollectionUri(
  documentDbDatabaseUrl,
  NOTIFICATION_COLLECTION_NAME
);
const notificationsStatusCollectionUrl = documentDbUtils.getCollectionUri(
  documentDbDatabaseUrl,
  NOTIFICATION_STATUS_COLLECTION_NAME
);

const documentClient = new DocumentDBClient(cosmosDbUri, {
  masterKey: cosmosDbKey
});

const messageModel = new MessageModel(
  documentClient,
  messagesCollectionUrl,
  messageContainerName
);

const serviceModel = new ServiceModel(documentClient, servicesCollectionUrl);

const messageStatusModel = new MessageStatusModel(
  documentClient,
  messageStatusCollectionUrl
);

const notificationModel = new NotificationModel(
  documentClient,
  notificationsCollectionUrl
);

const notificationStatusModel = new NotificationStatusModel(
  documentClient,
  notificationsStatusCollectionUrl
);

const storageConnectionString = getRequiredStringEnv("QueueStorageConnection");
const blobService = createBlobService(storageConnectionString);

app.get(
  "/api/v1/messages/:fiscalcode/:id",
  GetMessage(
    serviceModel,
    messageModel,
    messageStatusModel,
    notificationModel,
    notificationStatusModel,
    blobService
  )
);

const azureFunctionHandler = createAzureFunctionHandler(app);

// tslint:disable-next-line: no-let
let logger: Context["log"] | undefined;
const contextTransport = new AzureContextTransport(() => logger, {
  level: "debug"
});
winston.add(contextTransport);

// Binds the express app to an Azure Function handler
function httpStart(context: Context): void {
  logger = context.log;
  setAppContext(app, context);
  azureFunctionHandler(context);
}

export default httpStart;
