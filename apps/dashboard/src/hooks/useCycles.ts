import { useQuery } from "@tanstack/react-query"
import { fetchers } from "../api/client"

export function useCycles() {
  return useQuery({
    queryKey: ["cycles"],
    queryFn: () => fetchers.listCycles(),
    staleTime: 30_000,
  })
}

export function useCycleDetail(id: string | null) {
  return useQuery({
    queryKey: ["cycles", id],
    queryFn: () => fetchers.getCycle(id!),
    enabled: !!id,
    staleTime: 30_000,
  })
}
