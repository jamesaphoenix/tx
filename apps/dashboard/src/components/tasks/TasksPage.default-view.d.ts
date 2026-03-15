import type { DashboardDefaultTaskView } from "../../api/client"

declare module "./TasksPage" {
  interface TasksPageProps {
    defaultTaskView?: DashboardDefaultTaskView
  }
}

export {}
