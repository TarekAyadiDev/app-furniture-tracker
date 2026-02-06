import { useState } from 'react'

export default function App() {
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')

  const addItem = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: name.trim(), location: location.trim() || '—' },
    ])
    setName('')
    setLocation('')
  }

  const removeItem = (id) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  return (
    <div className="app">
      <header>
        <h1>Furniture Tracker</h1>
        <p>Track items and where they live.</p>
      </header>

      <form onSubmit={addItem} className="form">
        <input
          type="text"
          placeholder="Item name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Location (optional)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>

      <ul className="list">
        {items.length === 0 && (
          <li className="empty">No items yet. Add one above.</li>
        )}
        {items.map((item) => (
          <li key={item.id}>
            <span className="name">{item.name}</span>
            <span className="location">{item.location}</span>
            <button type="button" onClick={() => removeItem(item.id)} aria-label="Remove">
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
