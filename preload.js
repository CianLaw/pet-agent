'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('petAgent', {
  getState: () => ipcRenderer.invoke('get-state'),
  refreshBalance: () => ipcRenderer.invoke('refresh-balance'),
  onState: (fn) => {
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  onPetSay: (fn) => {
    const listener = (_e, text) => fn(text);
    ipcRenderer.on('pet-say', listener);
    return () => ipcRenderer.removeListener('pet-say', listener);
  },
  onUsageRemind: (fn) => {
    const listener = (_e, usage) => fn(usage);
    ipcRenderer.on('usage-remind', listener);
    return () => ipcRenderer.removeListener('usage-remind', listener);
  },
  onPetChatOpen: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('pet-chat-open', listener);
    return () => ipcRenderer.removeListener('pet-chat-open', listener);
  },
  onPetChatClose: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('pet-chat-close', listener);
    return () => ipcRenderer.removeListener('pet-chat-close', listener);
  },
  onPetWalkStart: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('pet-walk-start', listener);
    return () => ipcRenderer.removeListener('pet-walk-start', listener);
  },
  onPetWalkStop: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('pet-walk-stop', listener);
    return () => ipcRenderer.removeListener('pet-walk-stop', listener);
  },
  onPetFeed: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('pet-feed-do', listener);
    return () => ipcRenderer.removeListener('pet-feed-do', listener);
  },
  onPetPetHead: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('pet-pet-head-do', listener);
    return () => ipcRenderer.removeListener('pet-pet-head-do', listener);
  },
  onPetPlay: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('pet-play-do', listener);
    return () => ipcRenderer.removeListener('pet-play-do', listener);
  },
  dragStart: (payload) => ipcRenderer.send('drag-start', payload),
  dragMove: (pos) => ipcRenderer.send('drag-move', pos),
  dragEnd: () => ipcRenderer.send('drag-end'),
  notifyInteract: () => ipcRenderer.send('pet-interact'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  feedPet: () => ipcRenderer.send('pet-feed'),
  petHead: () => ipcRenderer.send('pet-pet-head'),
  playWith: () => ipcRenderer.send('pet-play'),
  chat: (text) => ipcRenderer.invoke('pet-chat', text),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  // 拖文件给宠物吃：渲染层传入 File 对象，用 webUtils 取真实路径，再由主进程移到废纸篓
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return file && file.path ? file.path : '';
    }
  },
  trashFiles: (paths) => ipcRenderer.invoke('trash-files', paths)
});
