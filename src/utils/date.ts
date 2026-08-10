import { config } from "../config";

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function formatDateBR(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    timeZone: config.scheduler.timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatLaunchMonth(captureDate: Date): string {
  const launchDate = addDays(captureDate, config.scheduler.launchOffsetDays);
  const year = launchDate.getFullYear();
  const month = String(launchDate.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function launchFolderName(launchMonth: string): string {
  return `Lançamento ${launchMonth}`;
}

export function daysBetween(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const fromStart = startOfDay(from);
  const toStart = startOfDay(to);
  return Math.round((toStart.getTime() - fromStart.getTime()) / msPerDay);
}

export function isWithinCaptureWindow(captureDate: Date, today: Date = new Date()): boolean {
  const days = daysBetween(today, captureDate);
  return days >= 0 && days <= config.scheduler.captureWindowDays;
}

export function parseLaunchMonthFromFolderName(name: string): string | null {
  const match = name.match(/^Lançamento (\d{4}-\d{2})$/);
  return match ? match[1] : null;
}

export function toISODate(date: Date): string {
  return date.toISOString().split("T")[0];
}
