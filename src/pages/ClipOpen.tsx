import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { pullNow } from "@/sync/syncNow";

export default function ClipOpen() {
  const { id } = useParams();
  const nav = useNavigate();
  const [state, setState] = useState<"loading" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) {
      setState("error");
      setError("Missing item id.");
      return;
    }

    let cancelled = false;
    void pullNow()
      .then(() => {
        if (cancelled) return;
        nav(`/items/${id}`, { replace: true });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setState("error");
        setError(err?.message || "Could not pull latest records.");
      });

    return () => {
      cancelled = true;
    };
  }, [id, nav]);

  if (state === "loading") {
    return (
      <Card className="p-4">
        <div className="space-y-2">
          <div className="text-base font-semibold">Opening clipped item...</div>
          <div className="text-sm text-muted-foreground">Pulling latest data from Airtable.</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="space-y-2">
        <div className="text-base font-semibold">Could not open clipped item</div>
        <div className="text-sm text-muted-foreground">{error || "Please sync from Settings and try again."}</div>
        <Button variant="secondary" onClick={() => nav("/items")}>
          Go to Items
        </Button>
      </div>
    </Card>
  );
}
