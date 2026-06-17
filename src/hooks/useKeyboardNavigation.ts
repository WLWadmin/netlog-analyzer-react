import { useState, useCallback, useEffect } from 'react';

interface Options<T> {
  items: T[];
  onSelect: (item: T, index: number) => void;
  onOpen?: (item: T, index: number) => void;
  onClose?: () => void;
  enabled?: boolean;
}

export function useKeyboardNavigation<T>({ items, onSelect, onOpen, onClose, enabled = true }: Options<T>) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled || items.length === 0) return;
    switch (event.key) {
      case 'ArrowDown': case 'j':
        event.preventDefault();
        setFocusedIndex(prev => { const next = prev < items.length - 1 ? prev + 1 : 0; onSelect(items[next], next); return next; });
        break;
      case 'ArrowUp': case 'k':
        event.preventDefault();
        setFocusedIndex(prev => { const next = prev > 0 ? prev - 1 : items.length - 1; onSelect(items[next], next); return next; });
        break;
      case 'Enter':
        event.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < items.length && onOpen) onOpen(items[focusedIndex], focusedIndex);
        break;
      case 'Escape':
        if (onClose) { event.preventDefault(); onClose(); }
        break;
    }
  }, [enabled, items, onSelect, onOpen, onClose, focusedIndex]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);

  return { focusedIndex, setFocusedIndex };
}
