import type { ComponentType, ReactNode } from "react";

export interface AdminShellProps {
  actions?: ReactNode;
  children?: ReactNode;
  enableDarkMode?: boolean;
  subtitle?: ReactNode;
  title: ReactNode;
}

declare const AdminShell: ComponentType<AdminShellProps>;

export default AdminShell;
export const AdminAccessDenied: ComponentType<{ message?: string }>;
export function useAdminDark(): boolean;
