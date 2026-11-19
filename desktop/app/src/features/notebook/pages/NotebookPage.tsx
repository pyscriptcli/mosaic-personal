"use client";

import MyDayView from "@/features/dashboard/components/MyDayView";

export function NotebookPage() {
  return <MyDayView userId="mosaic-local" currentUserName="Local User" showDailyActivity={false} resizableWorkspace />;
}
