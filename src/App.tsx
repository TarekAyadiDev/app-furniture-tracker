import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DataProvider } from "@/data/DataContext";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Shopping from "@/pages/Shopping";
import Items from "@/pages/Items";
import ItemDetail from "@/pages/ItemDetail";
import ClipOpen from "@/pages/ClipOpen";
import Rooms from "@/pages/Rooms";
import RoomDetail from "@/pages/RoomDetail";
import Budget from "@/pages/Budget";
import Review from "@/pages/Review";
import Stores from "@/pages/Stores";
import Settings from "@/pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ErrorBoundary>
        <DataProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Navigate to="/shopping" replace />} />
                <Route path="shopping" element={<Shopping />} />
                <Route path="items" element={<Items />} />
                <Route path="items/:id" element={<ItemDetail />} />
                <Route path="clip/open/:id" element={<ClipOpen />} />
                <Route path="rooms" element={<Rooms />} />
                <Route path="rooms/:id" element={<RoomDetail />} />
                <Route path="review" element={<Review />} />
                <Route path="stores" element={<Stores />} />
                <Route path="budget" element={<Budget />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </DataProvider>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
