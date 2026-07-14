import { useEffect } from 'react'
import { useChatStore } from '../store/chatStore'

export default function WorkspaceSwitcher() {
    const workspaces = useChatStore((state) => state.workspaces)
    const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId)
    const loadWorkspaces = useChatStore((state) => state.loadWorkspaces)
    const switchWorkspace = useChatStore((state) => state.switchWorkspace)
    const createWorkspace = useChatStore((state) => state.createWorkspace)

    useEffect(() => {
        void loadWorkspaces()
    }, [loadWorkspaces])

    if (workspaces.length === 0) {
        // Still loading (or the socket payload hasn't arrived yet).
        return null
    }

    const handleCreate = async () => {
        const name = window.prompt('Workspace name')
        if (!name || !name.trim()) {
            return
        }
        const result = await createWorkspace(name.trim())
        if (!result.ok) {
            window.alert(result.message || 'Failed to create workspace')
        }
    }

    return (
        <div className="hidden lg:flex w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-gray-200 bg-gray-50 py-3 dark:border-gray-800 dark:bg-gray-950">
            {workspaces.map((workspace) => {
                const isActive = workspace.id === activeWorkspaceId
                return (
                    <button
                        key={workspace.id}
                        type="button"
                        title={workspace.name}
                        onClick={() => void switchWorkspace(workspace.id)}
                        className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold uppercase transition hover:rounded-xl ${
                            isActive
                                ? 'bg-primary-600 text-white rounded-xl'
                                : 'bg-gray-200 text-gray-700 hover:bg-primary-600 hover:text-white dark:bg-gray-800 dark:text-gray-200'
                        }`}
                    >
                        {workspace.name.slice(0, 2)}
                    </button>
                )
            })}
            <button
                type="button"
                title="Create workspace"
                onClick={() => void handleCreate()}
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-200 text-lg text-gray-500 transition hover:rounded-xl hover:bg-primary-600 hover:text-white dark:bg-gray-800 dark:text-gray-400"
            >
                +
            </button>
        </div>
    )
}
