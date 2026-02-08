import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { BottomNav } from "@/components/BottomNav";
import ShopPage from "@/pages/ShopPage";
import ItemsPage from "@/pages/ItemsPage";
import RoomsPage from "@/pages/RoomsPage";
import BudgetPage from "@/pages/BudgetPage";
import SettingsPage from "@/pages/SettingsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <div className="mx-auto min-h-screen max-w-lg bg-background">
          <Routes>
            <Route path="/" element={<ShopPage />} />
            <Route path="/items" element={<ItemsPage />} />
            <Route path="/rooms" element={<RoomsPage />} />
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <BottomNav />
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
