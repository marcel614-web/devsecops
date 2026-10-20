// apps/web/src/lib/notificationMeta.ts
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { NotificationKind } from "@/services/notification.service";

export interface NotificationKindMeta {
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  textClassName: string;
}

export const NOTIFICATION_KIND_META: Record<
  NotificationKind,
  NotificationKindMeta
> = {
  SUCCESS: {
    label: "Succès",
    icon: CheckCircle2,
    iconClassName:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    textClassName: "text-emerald-600 dark:text-emerald-400",
  },
  WARNING: {
    label: "Avertissement",
    icon: AlertTriangle,
    iconClassName: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    textClassName: "text-amber-600 dark:text-amber-400",
  },
  DANGER: {
    label: "Danger",
    icon: XCircle,
    iconClassName: "bg-red-500/15 text-red-600 dark:text-red-400",
    textClassName: "text-red-600 dark:text-red-400",
  },
  INFO: {
    label: "Information",
    icon: Info,
    iconClassName: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    textClassName: "text-blue-600 dark:text-blue-400",
  },
};

export const NOTIFICATION_KIND_OPTIONS: Array<{
  value: NotificationKind;
  label: string;
}> = [
  { value: "SUCCESS", label: "Succès" },
  { value: "WARNING", label: "Avertissement" },
  { value: "DANGER", label: "Danger" },
  { value: "INFO", label: "Information" },
];
