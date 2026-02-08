import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type State = {
  hasError: boolean;
  error?: Error;
};

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep console output for debugging in production.
    console.error("App error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const message = this.state.error?.message || "Unexpected error.";
    return (
      <div className="min-h-screen bg-background px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <Card className="p-4">
            <div className="text-base font-semibold">Something went wrong</div>
            <div className="mt-2 text-sm text-muted-foreground">{message}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => window.location.reload()}>Reload</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(message).catch(() => undefined);
                }}
              >
                Copy error
              </Button>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">If this keeps happening, open DevTools and share the console error.</div>
          </Card>
        </div>
      </div>
    );
  }
}
