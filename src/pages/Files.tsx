import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { File as FileIcon, Folder, FolderOpen, FolderPlus, Trash2, Save, X, FilePlus2, Edit2, UploadCloud, Search, ChevronRight, Copy, Pencil, Move } from 'lucide-react';
import Editor from '@monaco-editor/react';
import ConfirmDialog from '../components/ConfirmDialog';
import { notify } from '../components/Notifications';
import UnsavedChangesBar from '../components/UnsavedChangesBar';

interface FileInfo {
  name: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

interface FileSearchResult {
  path: string;
  is_dir: boolean;
  size: number;
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getMonacoLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    properties: 'ini',
    txt: 'plaintext',
    log: 'plaintext',
    sh: 'shell',
    bat: 'bat',
    md: 'markdown',
    toml: 'ini',
    conf: 'ini',
    cfg: 'ini',
  };
  return map[ext] ?? 'plaintext';
}

export default function Files() {
  const { servers, selectedServerId, settings } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [directoryContents, setDirectoryContents] = useState<Record<string, FileInfo[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingFile, setEditingFile] = useState<{name: string, content: string, originalContent: string} | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<{ file: FileInfo, path: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'folder' | null>(null);
  const [createName, setCreateName] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{ startX: number, startWidth: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file: FileInfo, path: string, paths: string[] } | null>(null);
  const [fileAction, setFileAction] = useState<{ type: 'rename' | 'move', file: FileInfo, path: string, paths: string[] } | null>(null);
  const [fileActionValue, setFileActionValue] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const dragPathsRef = useRef<string[]>([]);
  const hoverFolderRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ path: string, x: number, y: number } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      if ((event.buttons & 1) === 0) {
        resizeRef.current = null;
        return;
      }
      setSidebarWidth(Math.min(600, Math.max(260, resize.startWidth + event.clientX - resize.startX)));
    };
    const stop = () => { resizeRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, []);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  useEffect(() => {
    setSearchQuery('');
  }, [currentPath]);

  useEffect(() => {
    if (!selectedServer || !searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      invoke<FileSearchResult[]>('search_server_files', {
        baseDir: selectedServer.install_path,
        query: searchQuery,
      }).then(results => {
        if (!cancelled) setSearchResults(results);
      }).catch(error => {
        if (!cancelled) notify(`Search failed: ${error}`, 'error');
      }).finally(() => {
        if (!cancelled) setSearching(false);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedServerId, searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingFile) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingFile]);

  useEffect(() => {
    if (selectedServer) {
      setDirectoryContents({});
      setExpandedPaths(new Set());
      setSelectedPaths(new Set());
      selectionAnchorRef.current = null;
      setCurrentPath('.');
      loadFiles('.');
    }
  }, [selectedServerId]);

  useEffect(() => {
    if (!selectedServer || editingFile) return;
    const timer = window.setInterval(() => loadFiles(currentPath, true), 2000);
    return () => window.clearInterval(timer);
  }, [selectedServerId, currentPath, editingFile]);

  const loadFiles = async (path: string, quiet = false, select = true) => {
    if (!selectedServer) return;
    if (!quiet) setLoading(true);
    if (!quiet) setError(null);
    try {
      const data = await invoke<FileInfo[]>('get_directory_contents', {
        baseDir: selectedServer.install_path,
        subPath: path
      });
      if (select || path === currentPath) setFiles(data);
      setDirectoryContents(contents => ({ ...contents, [path]: data }));
      if (select) setCurrentPath(path);
    } catch (err: any) {
      if (!quiet) setError(err.toString());
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedServer || editingFile) return;
    const listener = getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setDragActive(true);
      } else if (event.payload.type === 'leave') {
        setDragActive(false);
      } else {
        setDragActive(false);
        invoke<number>('import_dropped_files', {
          baseDir: selectedServer.install_path,
          subPath: currentPath,
          paths: event.payload.paths,
        }).then(count => {
          notify(`${count} file${count === 1 ? '' : 's'} uploaded`, 'success');
          loadFiles(currentPath, true);
        }).catch(cause => notify(`Upload failed: ${cause}`, 'error'));
      }
    });
    return () => { listener.then(unlisten => unlisten()); };
  }, [selectedServerId, currentPath, editingFile]);

  const handleFileClick = async (file: FileInfo, newPath: string) => {
    if (file.is_dir) {
      if (expandedPaths.has(newPath)) {
        setExpandedPaths(paths => {
          const next = new Set(paths);
          next.delete(newPath);
          return next;
        });
        if (currentPath.startsWith(`${newPath}/`)) {
          setCurrentPath(newPath);
          setFiles(directoryContents[newPath] ?? []);
        }
        return;
      }
      setExpandedPaths(paths => new Set(paths).add(newPath));
      await loadFiles(newPath, true);
    } else {
      savedScrollTop.current = listRef.current?.scrollTop ?? 0;
      const ext = file.name.split('.').pop()?.toLowerCase();
      const textExts = ['txt', 'json', 'yml', 'yaml', 'properties', 'log', 'sh', 'bat', 'xml', 'md', 'toml', 'conf', 'cfg'];
      if (!ext || !textExts.includes(ext)) {
        return;
      }

      try {
        const content = await invoke<string>('read_file_content', {
          baseDir: selectedServer!.install_path,
          subPath: newPath
        });
        setEditingFile({ name: newPath, content, originalContent: content });
      } catch (err: any) {
        notify('Failed to read file: ' + err, 'error');
      }
    }
  };

  const revealSearchResult = async (result: FileSearchResult) => {
    if (!selectedServer) return;
    const parts = result.path.split('/');
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const paths = ['.', ...parts.slice(0, result.is_dir ? parts.length : -1).map((_, index) => parts.slice(0, index + 1).join('/'))];
    try {
      const contents = await Promise.all(paths.map(path => invoke<FileInfo[]>('get_directory_contents', {
        baseDir: selectedServer.install_path,
        subPath: path,
      })));
      setDirectoryContents(current => Object.assign({}, current, ...paths.map((path, index) => ({ [path]: contents[index] }))));
      setExpandedPaths(current => new Set([...current, ...paths.filter(path => path !== '.')]));
      const selectedPath = result.is_dir ? result.path : parentPath;
      setCurrentPath(selectedPath);
      setFiles(contents[paths.indexOf(selectedPath)] ?? []);
      setSearchQuery('');
      if (!result.is_dir) {
        await handleFileClick({ name: parts[parts.length - 1], is_dir: false, size: result.size, modified: 0 }, result.path);
      }
    } catch (error) {
      notify(`Failed to reveal file: ${error}`, 'error');
    }
  };

  const saveFile = async () => {
    if (!editingFile || !selectedServer) return;
    setSaving(true);
    try {
      await invoke('save_file_content', {
        baseDir: selectedServer.install_path,
        subPath: editingFile.name,
        content: editingFile.content
      });
      setEditingFile({...editingFile, originalContent: editingFile.content});
      notify('File saved.', 'success', false);
    } catch (err: any) {
      notify('Failed to save file: ' + err, 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editingFile) return;
    const saveShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!saving && editingFile.content !== editingFile.originalContent) saveFile();
      }
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [editingFile, saving]);

  const performDelete = async (file: FileInfo, pathToDelete = currentPath === '.' ? file.name : `${currentPath}/${file.name}`) => {
    if (!selectedServer) return;
    try {
      const result = await invoke<string>('delete_file_or_folder', { baseDir: selectedServer.install_path, subPath: pathToDelete });
      setFileToDelete(null);
      if (result === 'scheduled') {
        notify(`${file.name} is in use. It will be deleted before next server start.`, 'warning', false);
      } else {
        notify(`${file.name} deleted.`, 'success', false);
        const parentPath = pathToDelete.includes('/') ? pathToDelete.slice(0, pathToDelete.lastIndexOf('/')) : '.';
        loadFiles(parentPath, true, false);
      }
    } catch (err: any) {
      notify('Failed to delete: ' + err, 'error');
    }
  };

  const deleteFile = (e: React.MouseEvent, file: FileInfo, path: string) => {
    e.stopPropagation();
    if (settings?.confirm_delete) setFileToDelete({ file, path });
    else performDelete(file, path);
  };

  const clearFolderHover = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    hoverFolderRef.current = null;
  };

  const moveFileOrFolder = async (sourcePath: string, destinationPath: string) => {
    if (!selectedServer || sourcePath === destinationPath) return;
    const sourceParent = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '.';
    const destinationParent = destinationPath.includes('/') ? destinationPath.slice(0, destinationPath.lastIndexOf('/')) : '.';
    try {
      await invoke('move_file_or_folder', {
        baseDir: selectedServer.install_path,
        sourcePath,
        destinationPath,
      });
      setDirectoryContents(contents => Object.fromEntries(Object.entries(contents).filter(([path]) => path !== sourcePath && !path.startsWith(`${sourcePath}/`))));
      setExpandedPaths(paths => new Set([...paths].map(path => path === sourcePath || path.startsWith(`${sourcePath}/`) ? destinationPath + path.slice(sourcePath.length) : path)));
      const movedCurrentPath = currentPath === sourcePath || currentPath.startsWith(`${sourcePath}/`) ? destinationPath + currentPath.slice(sourcePath.length) : null;
      if (editingFile && (editingFile.name === sourcePath || editingFile.name.startsWith(`${sourcePath}/`))) {
        setEditingFile({ ...editingFile, name: destinationPath + editingFile.name.slice(sourcePath.length) });
      }
      await Promise.all([...new Set([sourceParent, destinationParent])].map(path => loadFiles(path, true, false)));
      if (movedCurrentPath) await loadFiles(movedCurrentPath, true);
      notify('File moved.', 'success', false);
    } catch (error) {
      notify(`Failed to move: ${error}`, 'error');
    }
  };

  const moveFilesToFolder = async (sourcePaths: string[], destinationDir: string) => {
    if (!selectedServer) return;
    const sources = sourcePaths.filter(path => !sourcePaths.some(other => other !== path && path.startsWith(`${other}/`)));
    const destinations = sources.map(path => destinationDir === '.' ? path.split('/').pop()! : `${destinationDir}/${path.split('/').pop()!}`);
    if (sources.every((path, index) => path === destinations[index])) return;
    try {
      await invoke('move_files_or_folders', {
        baseDir: selectedServer.install_path,
        sourcePaths: sources,
        destinationDir,
      });
      const remap = (path: string) => {
        const index = sources.findIndex(source => path === source || path.startsWith(`${source}/`));
        return index === -1 ? path : destinations[index] + path.slice(sources[index].length);
      };
      setDirectoryContents(contents => Object.fromEntries(Object.entries(contents).filter(([path]) => !sources.some(source => path === source || path.startsWith(`${source}/`)))));
      setExpandedPaths(paths => new Set([...paths].map(remap)));
      setSelectedPaths(new Set(destinations));
      if (editingFile) setEditingFile({ ...editingFile, name: remap(editingFile.name) });
      const movedCurrentPath = remap(currentPath);
      const sourceParents = sources.map(path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');
      await Promise.all([...new Set([...sourceParents, destinationDir])].map(path => loadFiles(path, true, false)));
      if (movedCurrentPath !== currentPath) await loadFiles(movedCurrentPath, true);
      notify(`${sources.length} item${sources.length === 1 ? '' : 's'} moved.`, 'success', false);
    } catch (error) {
      notify(`Failed to move: ${error}`, 'error');
    }
  };

  const submitFileAction = async () => {
    if (!fileAction) return;
    const value = fileActionValue.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!value) return;
    const parent = fileAction.path.includes('/') ? fileAction.path.slice(0, fileAction.path.lastIndexOf('/')) : '.';
    if (fileAction.type === 'rename' && value.includes('/')) {
      notify('Name cannot contain slashes.', 'error');
      return;
    }
    if (fileAction.type === 'rename') {
      await moveFileOrFolder(fileAction.path, parent === '.' ? value : `${parent}/${value}`);
    } else {
      await moveFilesToFolder(fileAction.paths, value || '.');
    }
    setFileAction(null);
    setFileActionValue('');
  };

  const openContextMenu = (event: React.MouseEvent, file: FileInfo, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    const paths = selectedPaths.has(path) ? [...selectedPaths] : [path];
    if (!selectedPaths.has(path)) {
      setSelectedPaths(new Set([path]));
      selectionAnchorRef.current = path;
    }
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 140),
      file,
      path,
      paths,
    });
  };

  const selectEntry = (event: React.MouseEvent, path: string, open: () => void) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (event.shiftKey && selectionAnchorRef.current) {
      const visiblePaths = [...document.querySelectorAll<HTMLElement>('[data-entry-path]')].map(element => element.dataset.entryPath!);
      const start = visiblePaths.indexOf(selectionAnchorRef.current);
      const end = visiblePaths.indexOf(path);
      if (start !== -1 && end !== -1) {
        const range = visiblePaths.slice(Math.min(start, end), Math.max(start, end) + 1);
        if (event.ctrlKey || event.metaKey) {
          setSelectedPaths(paths => {
            const next = new Set(paths);
            range.forEach(p => next.add(p));
            return next;
          });
        } else {
          setSelectedPaths(new Set(range));
        }
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedPaths(paths => {
        const next = new Set(paths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      selectionAnchorRef.current = path;
      return;
    }
    setSelectedPaths(new Set([path]));
    selectionAnchorRef.current = path;
    open();
  };

  const startInternalDrag = (event: React.PointerEvent, path: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    let draggedPaths = selectedPaths.has(path) ? [...selectedPaths] : [path];
    if (!selectedPaths.has(path) && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      setSelectedPaths(new Set([path]));
      selectionAnchorRef.current = path;
    } else if (!selectedPaths.has(path) && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      // If they are starting a drag with modifiers on an unselected item, 
      // we don't want to break the drag by not having it in draggedPaths.
      // But we also don't want to break onClick by updating state too early.
      // So we just add it to draggedPaths for the drag operation.
      draggedPaths = [...selectedPaths, path];
    }
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const move = (moveEvent: PointerEvent) => {
      if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
      active = true;
      suppressClickRef.current = true;
      dragPathsRef.current = draggedPaths;
      setDragPreview({ path: draggedPaths.length === 1 ? path : `${draggedPaths.length} items`, x: moveEvent.clientX, y: moveEvent.clientY });
      const target = (document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop-path]');
      const folderPath = target?.dataset.dropPath;
      if (!folderPath || draggedPaths.some(source => folderPath === source || folderPath.startsWith(`${source}/`)) || hoverFolderRef.current === folderPath) return;
      clearFolderHover();
      hoverFolderRef.current = folderPath;
      hoverTimerRef.current = window.setTimeout(() => {
        if (folderPath !== '.') {
          setExpandedPaths(paths => new Set(paths).add(folderPath));
          loadFiles(folderPath, true, false);
        }
        hoverTimerRef.current = null;
      }, 1000);
    };
    const stop = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', cancel);
      if (active) {
        const target = (document.elementFromPoint(upEvent.clientX, upEvent.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop-path]');
        const folderPath = target?.dataset.dropPath;
        if (folderPath) moveFilesToFolder(draggedPaths, folderPath);
      }
      cancel();
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    };
    const cancel = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', cancel);
      clearFolderHover();
      dragPathsRef.current = [];
      setDragPreview(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', cancel);
  };

  const createEntry = async () => {
    if (!selectedServer || !createType || !createName.trim()) return;
    const name = createName.trim();
    const newPath = currentPath === '.' ? name : `${currentPath}/${name}`;
    try {
      if (createType === 'folder') {
        await invoke('create_new_folder', { baseDir: selectedServer.install_path, subPath: newPath });
        await loadFiles(currentPath);
      } else {
        await invoke('save_file_content', { baseDir: selectedServer.install_path, subPath: newPath, content: '' });
        await loadFiles(currentPath, true);
        setEditingFile({ name: newPath, content: '', originalContent: '' });
      }
      setCreateType(null);
      setCreateName('');
    } catch (err: any) {
      notify(`Failed to create ${createType}: ${err}`, 'error');
    }
  };

  const uploadFiles = async () => {
    if (!selectedServer) return;
    const selected = await open({ multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    try {
      const count = await invoke<number>('import_dropped_files', {
        baseDir: selectedServer.install_path,
        subPath: currentPath,
        paths,
      });
      notify(`${count} file${count === 1 ? '' : 's'} uploaded`, 'success');
      loadFiles(currentPath, true);
    } catch (cause) {
      notify(`Upload failed: ${cause}`, 'error');
    }
  };

  const closeEditor = () => {
    setEditingFile(null);
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = savedScrollTop.current;
    });
  };

  const renderDirectory = (path: string, depth = 0): ReactNode =>
    (directoryContents[path] ?? (path === currentPath ? files : []))
      .filter(file => file.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .map(file => {
        const filePath = path === '.' ? file.name : `${path}/${file.name}`;
        const expanded = file.is_dir && expandedPaths.has(filePath);
        return <div key={filePath}>
          <div
            data-entry-path={filePath}
            data-drop-path={file.is_dir ? filePath : undefined}
            onPointerDown={event => startInternalDrag(event, filePath)}
            onContextMenu={event => openContextMenu(event, file, filePath)}
            onClick={event => selectEntry(event, filePath, () => handleFileClick(file, filePath))}
            style={{ paddingLeft: 12 + depth * 16 }}
            className={`group flex cursor-pointer select-none items-center gap-2 border-l-2 py-2 pr-3 text-sm ${selectedPaths.has(filePath) ? 'border-blue-500 bg-blue-500/15 font-medium text-blue-200' : editingFile?.name === filePath ? 'border-blue-500 bg-blue-500/10 text-blue-300' : currentPath === filePath ? 'border-blue-500 bg-blue-500/10 font-medium text-blue-300' : 'border-transparent text-gray-400 hover:bg-[#1b1d22] hover:text-gray-100'}`}
          >
            {file.is_dir && <ChevronRight size={13} className={`shrink-0 text-gray-600 transition-transform ${expanded ? 'rotate-90' : ''}`} />}
            {file.is_dir ? (expanded ? <FolderOpen size={15} className="shrink-0 text-blue-400" /> : <Folder size={15} className="shrink-0 text-blue-400" />) : <FileIcon size={15} className="ml-[21px] shrink-0 text-gray-500" />}
            <span className="min-w-0 flex-1 truncate" title={filePath}>{file.name}</span>
            {!file.is_dir && <span className="text-[10px] tabular-nums text-gray-600">{formatBytes(file.size, 1)}</span>}
            <button aria-label={`Delete ${file.name}`} onClick={event => deleteFile(event, file, filePath)} className="rounded p-1 text-gray-600 opacity-0 hover:bg-[#2a2b2f] hover:text-red-400 group-hover:opacity-100"><Trash2 size={13} /></button>
          </div>
          {expanded && renderDirectory(filePath, depth + 1)}
        </div>;
      });

  if (!selectedServer) {
    return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full bg-[#0f0f11]">
      <aside style={{ width: sidebarWidth }} className="relative flex min-w-[260px] max-w-[600px] flex-shrink-0 flex-col border-r border-[#27282d] bg-[#121316]">
        <div
          role="separator"
          aria-label="Resize file sidebar"
          aria-orientation="vertical"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
          }}
          className="absolute inset-y-0 right-0 z-30 w-1 cursor-col-resize hover:bg-blue-500/60"
        />
        <div className="border-b border-[#27282d] p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-200">
            <Folder size={15} className="text-blue-400" /> File Manager
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  searchRef.current?.blur();
                }
              }}
              placeholder="Search files..."
              className="w-full rounded-md border border-[#292b31] bg-[#0d0e10] py-2 pl-9 pr-8 text-sm text-white outline-none focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={() => setCreateType('file')} className="flex items-center justify-center gap-2 rounded-md border border-[#292b31] bg-[#18191d] py-2 text-xs font-medium text-gray-300 hover:bg-[#202126] hover:text-white"><FilePlus2 size={14} /> New File</button>
            <button onClick={() => setCreateType('folder')} className="flex items-center justify-center gap-2 rounded-md border border-[#292b31] bg-[#18191d] py-2 text-xs font-medium text-gray-300 hover:bg-[#202126] hover:text-white"><FolderPlus size={14} /> New Folder</button>
          </div>
        </div>

        <div data-drop-path={currentPath} className="flex items-center gap-2 border-b border-[#23252a] px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-600" title={selectedServer.install_path}>
            {selectedServer.install_path}\{currentPath === '.' ? '' : currentPath.split('/').join('\\')}
          </span>
          <button
            type="button"
            onClick={() => {
              const path = currentPath === '.' ? selectedServer.install_path : `${selectedServer.install_path}/${currentPath}`;
              openUrl(`vscode://file/${encodeURI(path.replace(/\\/g, '/'))}`).catch(error => notify(`Failed to open VS Code: ${error}`, 'error'));
            }}
            className="shrink-0 rounded p-1.5 text-gray-500 hover:bg-[#23252a] hover:text-blue-400"
            title="Open in VS Code"
            aria-label="Open current folder in VS Code"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.6 2.2 8.6 10.5 4.4 7.3 2 9.5l4.2 3.9L2 17.3l2.4 2.2 4.2-3.2 9 8.3L22 22V4l-4.4-1.8Zm0 6v8.1l-5.4-4.1 5.4-4Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => openPath(currentPath === '.' ? selectedServer.install_path : `${selectedServer.install_path}/${currentPath}`).catch(error => notify(`Failed to open folder: ${error}`, 'error'))}
            className="shrink-0 rounded p-1.5 text-gray-500 hover:bg-[#23252a] hover:text-blue-400"
            title="Open folder"
            aria-label="Open current folder"
          >
            <FolderOpen size={14} />
          </button>
        </div>

        {error && <div className="m-3 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">{error}</div>}

        <div ref={listRef} onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-entry-path]')) { setSelectedPaths(new Set()); selectionAnchorRef.current = null; } }} className="relative flex-1 overflow-y-auto py-1">
          <div className={`pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-md border border-dashed border-blue-400 bg-blue-500/15 transition-opacity ${dragActive ? 'opacity-100' : 'opacity-0'}`}>
            <div className="text-center"><UploadCloud size={28} className="mx-auto mb-2 text-blue-300" /><p className="text-sm font-medium text-white">Drop files here</p></div>
          </div>
          {loading || searching ? Array.from({ length: 8 }).map((_, index) => <div key={index} className="mx-3 my-2 h-5 animate-pulse rounded bg-[#202228]" />)
            : searchQuery ? (searchResults.length === 0 ? <div className="px-4 py-10 text-center text-xs text-gray-600">No files matching "{searchQuery}"</div> : searchResults.map(result => {
              const file = { name: result.path.split('/').pop()!, is_dir: result.is_dir, size: result.size, modified: 0 };
              return <div key={result.path} data-entry-path={result.path} data-drop-path={result.is_dir ? result.path : undefined} onPointerDown={event => startInternalDrag(event, result.path)} onContextMenu={event => openContextMenu(event, file, result.path)} onClick={event => selectEntry(event, result.path, () => revealSearchResult(result))} className={`group flex cursor-pointer select-none items-center gap-2 border-l-2 px-3 py-2 text-sm ${selectedPaths.has(result.path) ? 'border-blue-500 bg-blue-500/15 text-blue-200' : 'border-transparent text-gray-400 hover:bg-[#1b1d22] hover:text-gray-100'}`}>
                {result.is_dir ? <Folder size={15} className="shrink-0 text-blue-400" /> : <FileIcon size={15} className="shrink-0 text-gray-500" />}
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={result.path}>{result.path}</span>
                {!result.is_dir && <span className="text-[10px] tabular-nums text-gray-600">{formatBytes(result.size, 1)}</span>}
              </div>;
            })) : (directoryContents['.'] ?? files).length === 0 ? <div className="px-4 py-10 text-center text-xs text-gray-600">Directory is empty.</div>
            : renderDirectory('.')}
        </div>
        <div className="border-t border-[#27282d] p-3">
          <button onClick={uploadFiles} className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-500"><UploadCloud size={14} /> Upload Files</button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {editingFile ? <>
          <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-[#27282d] bg-[#121316] px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><Edit2 size={15} className="text-gray-500" /><h2 className="truncate text-sm font-semibold text-gray-100">{editingFile.name.split('/').pop()}</h2></div>
              <p className="mt-1 truncate font-mono text-[11px] text-gray-600">/{editingFile.name}</p>
            </div>
            <div className="ml-4 flex gap-2">
              <button onClick={closeEditor} className="flex h-8 items-center gap-1.5 rounded-md border border-[#303238] px-3 text-xs text-gray-400 hover:bg-[#202124] hover:text-white"><X size={13} /> Close</button>
              <button onClick={saveFile} disabled={saving || editingFile.content === editingFile.originalContent} className="flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"><Save size={13} /> {saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <Editor height="100%" language={getMonacoLanguage(editingFile.name)} theme="vs-dark" value={editingFile.content} onChange={value => setEditingFile({ ...editingFile, content: value ?? '' })} options={{ fontSize: 13, fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace', fontLigatures: true, minimap: { enabled: true }, scrollBeyondLastLine: false, wordWrap: 'on', lineNumbers: 'on', renderLineHighlight: 'all', smoothScrolling: true, cursorSmoothCaretAnimation: 'on', bracketPairColorization: { enabled: true }, padding: { top: 14, bottom: 14 }, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 } }} />
          </div>
          <UnsavedChangesBar dirty={editingFile.content !== editingFile.originalContent} saving={saving} onSave={saveFile} onReset={() => setEditingFile({...editingFile, content: editingFile.originalContent})} />
        </> : <div className="flex flex-1 items-center justify-center">
          <div className="text-center"><FileIcon size={28} className="mx-auto mb-3 text-gray-700" /><p className="text-sm font-medium text-gray-400">Select a file to edit</p><p className="mt-1 text-xs text-gray-600">Text files open in the editor</p></div>
        </div>}
      </section>
      {dragPreview && (
        <div style={{ left: dragPreview.x + 12, top: dragPreview.y + 12 }} className="pointer-events-none fixed z-[60] max-w-64 truncate rounded-md border border-blue-500/40 bg-[#1b1c20] px-3 py-2 font-mono text-xs text-blue-200 shadow-xl">
          {dragPreview.path}
        </div>
      )}
      {contextMenu && (
        <div
          style={{ left: contextMenu.x, top: contextMenu.y }}
          className="fixed z-50 w-44 rounded-md border border-[#303238] bg-[#1b1c20] p-1 shadow-xl"
          onClick={event => event.stopPropagation()}
        >
          {contextMenu.paths.length === 1 && <button onClick={() => { setFileAction({ type: 'rename', file: contextMenu.file, path: contextMenu.path, paths: contextMenu.paths }); setFileActionValue(contextMenu.file.name); setContextMenu(null); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-gray-300 hover:bg-[#292b31] hover:text-white"><Pencil size={13} /> Rename</button>}
          <button onClick={() => {
            const paths = contextMenu.paths.map(path => `${selectedServer.install_path}\\${path.replace(/\//g, '\\')}`).join('\n');
            navigator.clipboard.writeText(paths).then(() => notify(`${contextMenu.paths.length} path${contextMenu.paths.length === 1 ? '' : 's'} copied.`, 'success')).catch(error => notify(`Failed to copy path: ${error}`, 'error'));
            setContextMenu(null);
          }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-gray-300 hover:bg-[#292b31] hover:text-white"><Copy size={13} /> Copy {contextMenu.paths.length === 1 ? 'path' : 'paths'}</button>
          <button onClick={() => {
            const parent = contextMenu.path.includes('/') ? contextMenu.path.slice(0, contextMenu.path.lastIndexOf('/')) : '.';
            setFileAction({ type: 'move', file: contextMenu.file, path: contextMenu.path, paths: contextMenu.paths });
            setFileActionValue(parent);
            setContextMenu(null);
          }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-gray-300 hover:bg-[#292b31] hover:text-white"><Move size={13} /> Move{contextMenu.paths.length > 1 ? ` ${contextMenu.paths.length} items` : ''}</button>
        </div>
      )}
      {fileToDelete && (
        <ConfirmDialog
          title={`Delete ${fileToDelete.file.is_dir ? 'folder' : 'file'}?`}
          message={`${fileToDelete.file.name} will be permanently deleted${fileToDelete.file.is_dir ? ' with all contents' : ''}.`}
          confirmLabel="Delete"
          onCancel={() => setFileToDelete(null)}
          onConfirm={() => performDelete(fileToDelete.file, fileToDelete.path)}
        />
      )}
      {fileAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <form onSubmit={event => { event.preventDefault(); submitFileAction(); }} className="w-full max-w-md rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-xl">
            <div className="p-5">
              <h2 className="font-semibold text-white">{fileAction.type === 'rename' ? `Rename ${fileAction.file.is_dir ? 'folder' : 'file'}` : fileAction.paths.length === 1 ? `Move ${fileAction.file.name}` : `Move ${fileAction.paths.length} items`}</h2>
              <label className="mt-4 block text-sm text-gray-400">{fileAction.type === 'rename' ? 'New name' : 'Destination folder'}</label>
              <input
                autoFocus
                value={fileActionValue}
                onChange={event => setFileActionValue(event.target.value)}
                placeholder={fileAction.type === 'rename' ? fileAction.file.name : 'plugins/disabled'}
                className="mt-2 w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2 font-mono text-sm text-white outline-none focus:border-blue-500"
              />
              {fileAction.type === 'move' && <p className="mt-2 text-xs text-gray-500">Path relative to server folder. Use . for server root.</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#2a2b2f] bg-[#141517] p-4">
              <button type="button" onClick={() => { setFileAction(null); setFileActionValue(''); }} className="h-9 rounded-md bg-[#2a2b2f] px-4 text-sm text-white hover:bg-[#3a3b3f]">Cancel</button>
              <button type="submit" disabled={!fileActionValue.trim()} className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{fileAction.type === 'rename' ? 'Rename' : 'Move'}</button>
            </div>
          </form>
        </div>
      )}
      {createType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <form onSubmit={event => { event.preventDefault(); createEntry(); }} className="w-full max-w-md rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-xl">
            <div className="p-5">
              <h2 className="font-semibold text-white">Create {createType === 'file' ? 'text file' : 'folder'}</h2>
              <label className="mt-4 block text-sm text-gray-400">Name</label>
              <input
                autoFocus
                value={createName}
                onChange={event => setCreateName(event.target.value)}
                placeholder={createType === 'file' ? 'notes.txt' : 'plugins'}
                className="mt-2 w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2 text-white outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-[#2a2b2f] bg-[#141517] p-4">
              <button type="button" onClick={() => { setCreateType(null); setCreateName(''); }} className="rounded-md bg-[#2a2b2f] px-4 py-2 text-sm text-white hover:bg-[#3a3b3f]">Cancel</button>
              <button type="submit" disabled={!createName.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
