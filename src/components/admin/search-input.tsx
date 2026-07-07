import { forwardRef, type InputHTMLAttributes } from "react";
import { SearchIcon } from "@/components/admin/icons";
import { cn } from "@/lib/utils";

type SearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { label, className, ...props },
  ref,
) {
  return (
    <label className="block">
      {label ? (
        <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      ) : null}
      <span className="relative block">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          ref={ref}
          className={cn(
            "h-10 w-full rounded-md border border-slate-300 bg-white pl-11 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600",
            className,
          )}
          {...props}
        />
      </span>
    </label>
  );
});
