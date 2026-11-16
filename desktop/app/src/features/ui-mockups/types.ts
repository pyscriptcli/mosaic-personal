export type MockupVariant = "workbench" | "studio" | "field";
export type MockupSection = "dashboard" | "projects" | "meetings" | "notebook" | "notetaker";
export type CaptureStatus = "ready" | "recording" | "paused" | "complete";
export type MeetingTab = "notes" | "transcript" | "actions";

export interface MockupTask {
  id: number;
  title: string;
  due: string;
  done: boolean;
}

export interface MockupAppState {
  section: MockupSection;
  navigateTo: (section: MockupSection) => void;
  dateRange: "Today" | "Week" | "Month";
  setDateRange: (range: "Today" | "Week" | "Month") => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedMeetingId: string;
  setSelectedMeetingId: (id: string) => void;
  projectFilter: "Active" | "All";
  setProjectFilter: (filter: "Active" | "All") => void;
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  tasks: MockupTask[];
  addTask: (title: string) => void;
  toggleTask: (id: number) => void;
  dayNote: string;
  setDayNote: (note: string) => void;
  captureStatus: CaptureStatus;
  setCaptureStatus: (status: CaptureStatus) => void;
  captureSource: "Screen 1" | "Mosaic window";
  setCaptureSource: (source: "Screen 1" | "Mosaic window") => void;
  meetingTab: MeetingTab;
  setMeetingTab: (tab: MeetingTab) => void;
  echoOpen: boolean;
  setEchoOpen: (open: boolean) => void;
  echoQuery: string;
  setEchoQuery: (query: string) => void;
  echoAnswer: string;
  setEchoAnswer: (answer: string) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  compactMode: boolean;
  setCompactMode: (enabled: boolean) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
}
