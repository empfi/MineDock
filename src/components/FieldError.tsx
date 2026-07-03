export default function FieldError({ id, message }: { id: string; message?: string }) {
  return <p id={id} className={`mt-1 min-h-4 text-xs ${message ? 'text-red-400' : 'text-transparent'}`}>{message || 'No error'}</p>;
}
