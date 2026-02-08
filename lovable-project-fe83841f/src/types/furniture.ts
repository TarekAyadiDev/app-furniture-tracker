export type RoomName = 'Living' | 'Dining' | 'Master' | 'Bedroom2' | 'Balcony' | 'Entry' | 'Kitchen' | 'Bath';

export type ItemStatus = 'Idea' | 'Shortlist' | 'Selected' | 'Ordered' | 'Delivered' | 'Installed';

export interface FurnitureItem {
  id: string;
  title: string;
  room: RoomName;
  status: ItemStatus;
  price?: number;
  store?: string;
  notes?: string;
  link?: string;
  quantity: number;
  createdAt: string;
}

export interface Room {
  name: RoomName;
  icon: string;
  itemCount: number;
  totalBudget: number;
}

export interface Measurement {
  id: string;
  room: RoomName;
  label: string;
  valueIn: number;
  valueCm: number;
  confidence: 'low' | 'med' | 'high';
}
