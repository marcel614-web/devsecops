// apps/web/src/components/ui/Pagination.tsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";

interface Props {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}

export function Pagination({ page, totalPages, onPage }: Props) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between py-4">
      <p className="text-sm text-muted">
        Page <strong>{page}</strong> sur <strong>{totalPages}</strong>
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="w-4 h-4" /> Précédent
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
        >
          Suivant <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}