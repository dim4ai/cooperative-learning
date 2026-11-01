/// <reference types="vite/client" />

// File System Access API (Chromium only). Not in TS lib.dom yet.
interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface FilePickerOptions {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  suggestedName?: string
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemFileHandle {
  queryPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface Window {
  showOpenFilePicker?: (opts?: FilePickerOptions & { multiple?: boolean }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (opts?: FilePickerOptions) => Promise<FileSystemFileHandle>
}
