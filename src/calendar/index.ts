import { google, calendar_v3 } from "googleapis";
import fs from "fs";
import { config } from "../config";
import { logger } from "../utils/logger";
import type { CaptureEvent } from "../types";
import {
  addDays,
  endOfDay,
  isWithinCaptureWindow,
  startOfDay,
} from "../utils/date";
import { extractLabelFromCaptureTitle } from "../services/specialistResolver";

const CAPTURE_PATTERNS = [/CAPTAÇÃO/i, /\[CAPTACAO\]/i, /CAPTACAO/i];

let calendarClient: calendar_v3.Calendar | null = null;

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
];

export function getGoogleAuth() {
  const credentialsPath = config.google.credentialsPath;
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Google credentials file not found: ${credentialsPath}`);
  }
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));

  // Google Workspace: impersonate a domain user (required when calendar
  // sharing only allows free/busy for external service accounts).
  if (config.google.impersonateUser) {
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("credentials.json missing client_email or private_key");
    }
    logger.info(
      { subject: config.google.impersonateUser },
      "Google auth using domain-wide delegation"
    );
    return new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: GOOGLE_SCOPES,
      subject: config.google.impersonateUser,
    });
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: GOOGLE_SCOPES,
  });
}

export function getCalendarClient(): calendar_v3.Calendar {
  if (!calendarClient) {
    const auth = getGoogleAuth();
    calendarClient = google.calendar({ version: "v3", auth });
  }
  return calendarClient;
}

export function isCaptureEvent(title: string): boolean {
  return CAPTURE_PATTERNS.some((p) => p.test(title));
}

function getEventDate(event: calendar_v3.Schema$Event): Date | null {
  if (event.start?.date) {
    return startOfDay(new Date(event.start.date + "T12:00:00"));
  }
  if (event.start?.dateTime) {
    return startOfDay(new Date(event.start.dateTime));
  }
  return null;
}

export async function fetchUpcomingCaptureEvents(
  referenceDate: Date = new Date()
): Promise<CaptureEvent[]> {
  const calendar = getCalendarClient();
  const timeMin = startOfDay(referenceDate);
  const timeMax = endOfDay(addDays(referenceDate, config.scheduler.captureWindowDays));

  const response = await calendar.events.list({
    calendarId: config.google.calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  const events = response.data.items ?? [];
  const captureEvents: CaptureEvent[] = [];

  for (const event of events) {
    if (!event.id || !event.summary) continue;
    if (!isCaptureEvent(event.summary)) continue;

    const captureDate = getEventDate(event);
    if (!captureDate) continue;
    if (!isWithinCaptureWindow(captureDate, referenceDate)) continue;

    const specialistLabel = extractLabelFromCaptureTitle(event.summary);
    if (!specialistLabel) {
      logger.warn({ title: event.summary }, "Could not extract specialist from event");
      continue;
    }

    captureEvents.push({
      eventId: event.id,
      title: event.summary,
      specialistLabel,
      captureDate,
    });
  }

  return captureEvents;
}

export async function fetchCaptureEventById(eventId: string): Promise<CaptureEvent | null> {
  const calendar = getCalendarClient();
  const response = await calendar.events.get({
    calendarId: config.google.calendarId,
    eventId,
  });

  const event = response.data;
  if (!event.summary || !event.id) return null;
  if (!isCaptureEvent(event.summary)) return null;

  const captureDate = getEventDate(event);
  if (!captureDate) return null;

  const specialistLabel = extractLabelFromCaptureTitle(event.summary);
  if (!specialistLabel) return null;

  return {
    eventId: event.id,
    title: event.summary,
    specialistLabel,
    captureDate,
  };
}
