export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-surface-border-strong bg-surface px-6 text-center text-sm text-text-secondary">
      {message}
    </div>
  );
}
