import { ALL_FEATURES, ALL_APP_PAGES } from "@/lib/access-control";

export type AdminConfig = Record<string, unknown> & {
  features: { askEchoEnabled: boolean };
};

export class AdminConfigError extends Error {
  status = 503;
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigError";
  }
}

export async function loadAdminConfig(): Promise<AdminConfig> {
  return {
    defaultPageAccess: ALL_APP_PAGES,
    defaultFeatureAccess: ALL_FEATURES,
    pagePermissions: [],
    admins: [],
    features: { askEchoEnabled: true },
  };
}

export async function isAskEchoEnabled(): Promise<boolean> {
  return true;
}
