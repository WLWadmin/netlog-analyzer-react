export interface TimelineRange {
  startUs: number;
  endUs: number;
}

export interface TimelineInteractionSnapshot {
  viewport: TimelineRange;
  selection?: TimelineRange;
  cursorUs?: number;
  hoveredEventId?: string;
  selectedEventId?: string;
  highlightedEntityId?: string;
  collapsedTrackIds: string[];
  pinnedTrackIds: string[];
  hiddenTrackIds: string[];
}

export interface TimelineHistoryEntry {
  viewport: TimelineRange;
  selection?: TimelineRange;
  selectedEventId?: string;
  drawerOpen: boolean;
  scrollTop: number;
}

type Listener = () => void;

function normalizeRange(range: TimelineRange): TimelineRange | undefined {
  if (!Number.isFinite(range.startUs) || !Number.isFinite(range.endUs)) return undefined;
  return range.startUs <= range.endUs
    ? range
    : { startUs: range.endUs, endUs: range.startUs };
}

function clampRange(range: TimelineRange, captureRange: TimelineRange): TimelineRange {
  const captureDuration = captureRange.endUs - captureRange.startUs;
  const duration = Math.min(range.endUs - range.startUs, captureDuration);
  const startUs = Math.max(
    captureRange.startUs,
    Math.min(range.startUs, captureRange.endUs - duration),
  );
  return { startUs, endUs: startUs + duration };
}

export class TimelineInteractionStore {
  private snapshot: TimelineInteractionSnapshot;
  private readonly listeners = new Set<Listener>();
  private readonly history: TimelineHistoryEntry[] = [];

  private readonly captureRange: TimelineRange;

  constructor(initialViewport: TimelineRange) {
    const viewport = normalizeRange(initialViewport);
    if (!viewport) throw new Error('Timeline viewport must be finite');
    this.captureRange = viewport;
    this.snapshot = {
      viewport,
      collapsedTrackIds: [],
      pinnedTrackIds: [],
      hiddenTrackIds: [],
    };
  }

  getSnapshot = (): TimelineInteractionSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setViewport(viewport: TimelineRange): void {
    const normalized = normalizeRange(viewport);
    if (!normalized || normalized.endUs === normalized.startUs) return;
    const next = clampRange(normalized, this.captureRange);
    if (
      next.startUs === this.snapshot.viewport.startUs
      && next.endUs === this.snapshot.viewport.endUs
    ) return;
    this.update({
      ...this.snapshot,
      viewport: next,
    });
  }

  setSelection(selection: TimelineRange | undefined): void {
    const normalized = selection ? normalizeRange(selection) : undefined;
    const next = normalized ? clampRange(normalized, this.captureRange) : undefined;
    if (
      next?.startUs === this.snapshot.selection?.startUs
      && next?.endUs === this.snapshot.selection?.endUs
    ) return;
    this.update({
      ...this.snapshot,
      selection: next,
    });
  }

  setCursor(cursorUs: number | undefined): void {
    const normalized = cursorUs === undefined
      ? undefined
      : Math.max(this.captureRange.startUs, Math.min(cursorUs, this.captureRange.endUs));
    if (normalized === this.snapshot.cursorUs) return;
    this.update({ ...this.snapshot, cursorUs: normalized });
  }

  setHoveredEvent(hoveredEventId: string | undefined): void {
    if (hoveredEventId === this.snapshot.hoveredEventId) return;
    this.update({ ...this.snapshot, hoveredEventId });
  }

  selectEvent(selectedEventId: string | undefined): void {
    if (selectedEventId === this.snapshot.selectedEventId) return;
    this.update({ ...this.snapshot, selectedEventId });
  }

  highlightEntity(highlightedEntityId: string | undefined): void {
    if (highlightedEntityId === this.snapshot.highlightedEntityId) return;
    this.update({ ...this.snapshot, highlightedEntityId });
  }

  toggleTrack(trackId: string): void {
    const collapsed = new Set(this.snapshot.collapsedTrackIds);
    if (collapsed.has(trackId)) collapsed.delete(trackId);
    else collapsed.add(trackId);
    this.update({
      ...this.snapshot,
      collapsedTrackIds: [...collapsed].sort(),
    });
  }

  togglePinnedTrack(trackId: string): void {
    this.toggleTrackSet('pinnedTrackIds', trackId);
  }

  toggleHiddenTrack(trackId: string): void {
    this.toggleTrackSet('hiddenTrackIds', trackId);
  }

  navigateTo(target: {
    viewport: TimelineRange;
    selectedEventId?: string;
  }, context: { drawerOpen: boolean; scrollTop: number } = {
    drawerOpen: false,
    scrollTop: 0,
  }): void {
    const viewport = normalizeRange(target.viewport);
    if (!viewport || viewport.startUs === viewport.endUs) return;
    this.saveHistory(context);
    this.update({
      ...this.snapshot,
      viewport: clampRange(viewport, this.captureRange),
      selectedEventId: target.selectedEventId,
    });
  }

  saveHistory(context: { drawerOpen: boolean; scrollTop: number }): void {
    this.history.push({
      viewport: this.snapshot.viewport,
      selection: this.snapshot.selection,
      selectedEventId: this.snapshot.selectedEventId,
      drawerOpen: context.drawerOpen,
      scrollTop: context.scrollTop,
    });
  }

  hasHistory(): boolean {
    return this.history.length > 0;
  }

  restorePrevious(): TimelineHistoryEntry | undefined {
    const previous = this.history.pop();
    if (!previous) return undefined;
    this.update({
      ...this.snapshot,
      viewport: previous.viewport,
      selection: previous.selection,
      selectedEventId: previous.selectedEventId,
    });
    return previous;
  }

  private update(snapshot: TimelineInteractionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private toggleTrackSet(
    key: 'pinnedTrackIds' | 'hiddenTrackIds',
    trackId: string,
  ): void {
    const values = new Set(this.snapshot[key]);
    if (values.has(trackId)) values.delete(trackId);
    else values.add(trackId);
    this.update({
      ...this.snapshot,
      [key]: [...values].sort(),
    });
  }
}
