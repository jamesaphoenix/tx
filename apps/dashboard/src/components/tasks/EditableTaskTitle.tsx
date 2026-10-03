import { useId, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "../ui"
import { fetchers, type TaskDetailResponse } from "../../api/client"

export function EditableTaskTitle({taskId, title}: {taskId: string; title: string}) {
  const queryClient = useQueryClient()
  const errorId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [validationError, setValidationError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (nextTitle: string) => fetchers.updateTask(taskId, {title: nextTitle}),
    onSuccess: (updated) => {
      queryClient.setQueriesData<TaskDetailResponse>({queryKey: ["task"]}, existing =>
        existing?.task.id === updated.id ? {...existing, task: {...existing.task, title: updated.title}} : existing)
      void queryClient.invalidateQueries({queryKey: ["task", updated.id]})
      void queryClient.invalidateQueries({queryKey: ["tasks"]})
      void queryClient.invalidateQueries({queryKey: ["task-breadcrumbs"]})
      void queryClient.invalidateQueries({queryKey: ["doc-graph"]})
      setEditing(false)
    },
  })
  const cancel = () => { setEditing(false); setValidationError(null); save.reset() }
  const submit = () => {
    if (save.isPending) return
    const nextTitle = draft.trim()
    if (!nextTitle) { setValidationError("Enter a task title."); return }
    if (nextTitle === title) { cancel(); return }
    setValidationError(null)
    save.mutate(nextTitle)
  }
  if (!editing) return <h2 className="text-2xl font-semibold text-white">
    <button type="button" title="Edit task title" className="group inline-flex items-start gap-2 rounded text-left hover:text-gray-300 focus-visible:outline focus-visible:outline-blue-400"
      onClick={() => {setDraft(title); save.reset(); setValidationError(null); setEditing(true)}}>{title}<svg aria-hidden="true" className="mt-2 h-4 w-4 shrink-0 text-gray-500 group-hover:text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m16 3 5 5-12 12H4v-5Z" /></svg></button>
  </h2>
  return <div>
    <input autoFocus aria-label="Task title" data-native-select-all="true" value={draft}
      aria-invalid={Boolean(validationError || save.error)} aria-describedby={validationError || save.error ? errorId : undefined}
      disabled={save.isPending} onChange={event => {setDraft(event.target.value); setValidationError(null)}}
      onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {event.preventDefault(); event.stopPropagation(); submit()}
        if (event.key === "Escape" && !save.isPending) {event.preventDefault(); event.stopPropagation(); cancel()}
      }} className="w-full rounded border border-gray-600 bg-gray-900 p-2 text-2xl font-semibold text-white" />
    <div className="mt-2 flex gap-2">
      <Button type="button" variant="primary" disabled={save.isPending} onClick={submit}>{save.isPending ? "Saving..." : "Save title"}</Button>
      <Button type="button" disabled={save.isPending} onClick={cancel}>Cancel title edit</Button>
    </div>
    {(validationError || save.error) && <p id={errorId} role="alert" className="mt-2 text-red-400">{validationError ?? save.error?.message ?? "Could not save the task title."}</p>}
  </div>
}
