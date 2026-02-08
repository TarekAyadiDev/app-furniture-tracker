import { useState, useCallback } from 'react';
import type { FurnitureItem, RoomName, ItemStatus } from '@/types/furniture';

const STORAGE_KEY = 'furniture-tracker-items';

function loadItems(): FurnitureItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveItems(items: FurnitureItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function useFurnitureStore() {
  const [items, setItems] = useState<FurnitureItem[]>(loadItems);

  const addItem = useCallback((item: Omit<FurnitureItem, 'id' | 'createdAt'>) => {
    const newItem: FurnitureItem = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    setItems(prev => {
      const next = [newItem, ...prev];
      saveItems(next);
      return next;
    });
    return newItem;
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<FurnitureItem>) => {
    setItems(prev => {
      const next = prev.map(i => i.id === id ? { ...i, ...updates } : i);
      saveItems(next);
      return next;
    });
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id);
      saveItems(next);
      return next;
    });
  }, []);

  const getByRoom = useCallback((room: RoomName) => {
    return items.filter(i => i.room === room);
  }, [items]);

  const getByStatus = useCallback((status: ItemStatus) => {
    return items.filter(i => i.status === status);
  }, [items]);

  const totalSpent = items.reduce((sum, i) => sum + (i.price || 0) * i.quantity, 0);
  const totalItems = items.length;

  return { items, addItem, updateItem, deleteItem, getByRoom, getByStatus, totalSpent, totalItems };
}
