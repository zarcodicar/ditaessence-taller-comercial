'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import {
  Archive,
  Barcode,
  Download,
  ImagePlus,
  LockKeyhole,
  PackagePlus,
  Pencil,
  PlusCircle,
  Search,
  Tags,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
const blank = (category = '') => ({
  name: '',
  barcode: '',
  cost: '',
  price: '',
  stock: '',
  min: '',
  category,
  image: '',
});
const codeKey = (product: any) => {
  const code = String(product?.barcode || product?.sku || '').trim().toLocaleUpperCase('es');
  return code && code !== 'SIN-CÓDIGO' ? code : '';
};

export function InventoryControl({
  products,
  categories = [],
  addCategory,
  renameCategory,
  removeCategory,
  onNotice,
  add,
  update,
  remove,
  canSeeCosts = true,
  canSeeFinancials = true,
  canManage = true,
  canDelete = true,
  canEditCategories = true,
  canDeleteCategories = true,
}: any) {
  const [filter, setFilter] = useState('Todos');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(blank());
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const list = products.filter((p: any) => {
    const code = p.barcode || p.sku || '';
    const match =
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      code.includes(query);
    const statusMatch =
      filter === 'Todos' ||
      (filter === 'Bajo stock' && p.stock > 0 && p.stock <= p.min) ||
      (filter === 'Agotados' && p.stock === 0);
    const categoryMatch =
      categoryFilter === 'Todas' || p.category === categoryFilter;
    return match && statusMatch && categoryMatch;
  });
  const value = useMemo(
    () =>
      products.reduce(
        (sum: number, p: any) => sum + (p.cost ?? p.price) * p.stock,
        0,
      ),
    [products],
  );
  const low = products.filter(
    (p: any) => p.stock > 0 && p.stock <= p.min,
  ).length;
  const depleted = products.filter((p: any) => p.stock === 0).length;
  const codes = products.filter(
    (p: any) => p.sku && p.sku !== 'SIN-CÓDIGO',
  ).length;
  const duplicateCodeGroups = useMemo(() => {
    const grouped = new Map<string, any[]>();
    products.forEach((product: any) => {
      const code = codeKey(product);
      if (!code) return;
      grouped.set(code, [...(grouped.get(code) || []), product]);
    });
    return [...grouped.entries()]
      .filter(([, matchingProducts]) => matchingProducts.length > 1)
      .map(([code, matchingProducts]) => ({ code, products: matchingProducts }));
  }, [products]);
  const healthy = low === 0 && depleted === 0;
  const close = () => {
    setEditing(null);
    setForm(blank());
    setFormError('');
  };
  const openNew = () => {
    if (!canManage) return;
    setEditing('new');
    setForm(blank());
    setFormError('');
  };
  const openEdit = (product: any) => {
    if (!canManage) return;
    setEditing(product);
    setFormError('');
    setForm({
      name: product.name,
      barcode: product.barcode || product.sku || '',
      cost: String(product.cost ?? ''),
      price: String(product.price),
      stock: String(product.stock),
      min: String(product.min),
      category: categories.includes(product.category) ? product.category : '',
      image: product.image || '',
    });
  };
  const save = () => {
    const requestedCategory = form.category.trim();
    const category =
      categories.find(
        (item: string) =>
          item.toLocaleLowerCase('es') ===
          requestedCategory.toLocaleLowerCase('es'),
      ) || '';
    if (
      !canManage ||
      !form.name.trim() ||
      !form.price ||
      form.stock === '' ||
      !category
    )
      return;
    const barcode = form.barcode.trim();
    const normalizedBarcode = codeKey({ barcode });
    const repeated = normalizedBarcode
      ? products.find((item: any) => item.id !== (editing === 'new' ? null : editing.id) && codeKey(item) === normalizedBarcode)
      : null;
    if (repeated) {
      const message = `No se puede guardar: el código “${barcode}” ya pertenece a “${repeated.name}”. Escribe o escanea un código diferente.`;
      setFormError(message);
      onNotice?.(message);
      return;
    }
    const product = {
      id: editing === 'new' ? Date.now() : editing.id,
      name: form.name.trim(),
      barcode,
      sku: barcode || 'SIN-CÓDIGO',
      cost: Number(form.cost) || 0,
      price: Number(form.price),
      stock: Number(form.stock),
      min: Number(form.min) || 0,
      image: form.image,
      category,
    };
    editing === 'new' ? add(product) : update(product);
    close();
  };
  const createCategory = () => {
    const name = newCategory.trim();
    if (!canManage || !name) return;
    const existing = categories.find(
      (item: string) =>
        item.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'),
    );
    const savedName = existing || name;
    if (!existing) addCategory?.(savedName);
    setForm((old) => ({ ...old, category: savedName }));
    setCategoryFilter(savedName);
    setNewCategory('');
    setCreatingCategory(false);
  };
  const saveCategoryName = () => {
    const oldName = editingCategory;
    const name = newCategory.trim();
    if (!canEditCategories || !oldName || !name) return;
    const duplicate = categories.some(
      (item: string) =>
        item !== oldName &&
        item.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'),
    );
    if (duplicate) return;
    renameCategory?.(oldName, name);
    onNotice?.(`Categoría “${oldName}” actualizada a “${name}”.`);
    setCategoryFilter(name);
    setForm((old) => ({
      ...old,
      category: old.category === oldName ? name : old.category,
    }));
    setEditingCategory(null);
    setNewCategory('');
  };
  const deleteCategory = () => {
    if (
      !canDeleteCategories ||
      categoryFilter === 'Todas' ||
      !window.confirm(
        `¿Borrar la categoría “${categoryFilter}”? Los productos que la usan quedarán como “Sin categoría”, pero no serán eliminados.`,
      )
    )
      return;
    removeCategory?.(categoryFilter);
    setCategoryFilter('Todas');
  };
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    if (!canManage) return;
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () =>
      setForm((old) => ({ ...old, image: String(reader.result) }));
    reader.readAsDataURL(file);
  };
  const exportCsv = () => {
    if (!canManage) return;
    const head = [
      'Producto',
      'Categoría',
      'Código de barras',
      'Costo',
      'Precio de venta',
      'Stock',
      'Stock mínimo',
      'Estado',
    ];
    const rows = products.map((p: any) => [
      p.name,
      categories.includes(p.category) ? p.category : '',
      p.barcode || p.sku,
      p.cost || 0,
      p.price,
      p.stock,
      p.min,
      p.stock === 0
        ? 'Agotado'
        : p.stock <= p.min
          ? 'Bajo stock'
          : 'Disponible',
    ]);
    const csv = [head, ...rows]
      .map((row) =>
        row.map((item) => `"${String(item).replaceAll('"', '""')}"`).join(','),
      )
      .join('\n');
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'inventario-ditaessencepos.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const deleteOne = (product: any) => {
    if (
      !canDelete ||
      !window.confirm(
        `¿Borrar “${product.name}” del inventario? Esta acción no se puede deshacer.`,
      )
    )
      return;
    remove(product.id);
    setSelected((old) => old.filter((id) => id !== product.id));
  };
  const deleteSelected = () => {
    if (
      !canDelete ||
      !selected.length ||
      !window.confirm(
        `¿Borrar ${selected.length} producto${selected.length === 1 ? '' : 's'} seleccionado${selected.length === 1 ? '' : 's'}? Esta acción no se puede deshacer.`,
      )
    )
      return;
    selected.forEach(remove);
    setSelected([]);
  };
  return (
    <section className="inventory-view">
      <div className="inventory-titlebar">
        <div>
          <h2>Inventario</h2>
          <p className="inventory-search-help">
            Busca, filtra por categoría o escanea un código con el lector.
          </p>
        </div>
        <div className="inventory-title-actions">
          <label className="inventory-search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              name="inventory-product-search"
              placeholder="Buscar producto o código de barras..."
            />
          </label>
          {canManage ? (
            <Button onClick={openNew} className="inventory-primary">
              <PackagePlus />
              Nuevo producto
            </Button>
          ) : (
            <span className="inventory-readonly">
              <LockKeyhole />
              Solo consulta
            </span>
          )}
        </div>
      </div>
      <div className="inventory-stats">
        {canSeeFinancials && (
          <Stat
            icon={<Archive />}
            color="blue"
            label="Valor total stock"
            value={money.format(value)}
            note="Capital en mercancía"
          />
        )}
        <Stat
          icon={<TriangleAlert />}
          color="amber"
          label="Alertas stock bajo"
          value={`${low} productos`}
          note="Revisar reposición"
        />
        <Stat
          icon={<Barcode />}
          color="cyan"
          label="Códigos activos"
          value={`${codes} códigos`}
          note="Códigos asignados"
        />
      </div>
      {duplicateCodeGroups.length > 0 && (
        <div className="inventory-duplicate-alert" role="alert">
          <TriangleAlert />
          <div>
            <b>{duplicateCodeGroups.length} código{duplicateCodeGroups.length === 1 ? '' : 's'} duplicado{duplicateCodeGroups.length === 1 ? '' : 's'} detectado{duplicateCodeGroups.length === 1 ? '' : 's'}</b>
            <p>Corrige cada producto con el botón de editar antes de venderlos con lector.</p>
            <ul>
              {duplicateCodeGroups.map((group) => (
                <li key={group.code}>
                  <button type="button" onClick={() => { setQuery(group.code); setFilter('Todos'); setCategoryFilter('Todas'); }}>
                    Código {group.code}
                  </button>
                  <span>{group.products.map((product: any) => product.name).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="inventory-category-bar">
        <label>
          <Tags />
          <span>Categoría</span>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="Todas">Todas las categorías</option>
            {categories.map((category: string) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        {canManage && (
          <div className="inventory-category-actions">
            <Button variant="outline" onClick={() => setCreatingCategory(true)}>
              <PlusCircle />
              Nueva categoría
            </Button>
            {canEditCategories && categoryFilter !== 'Todas' && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingCategory(categoryFilter);
                  setNewCategory(categoryFilter);
                }}
              >
                <Pencil />
                Editar categoría
              </Button>
            )}
            {canDeleteCategories && categoryFilter !== 'Todas' && (
              <Button className="inventory-delete" onClick={deleteCategory}>
                <Trash2 />
                Borrar categoría
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="inventory-toolbar">
        <div className="inventory-tabs">
          {['Todos', 'Bajo stock', 'Agotados'].map((x) => (
            <button
              key={x}
              onClick={() => setFilter(x)}
              className={filter === x ? 'is-active' : ''}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="inventory-actions">
          {canManage && (
            <>
              <Button variant="outline" onClick={exportCsv}>
                <Download />
                Exportar
              </Button>
              <Button variant="outline" onClick={openNew}>
                <Barcode />
                Entrada rápida
              </Button>
            </>
          )}
          {canDelete && (
            <Button
              className="inventory-delete"
              disabled={!selected.length}
              onClick={deleteSelected}
            >
              <Trash2 />
              Borrar seleccionados
            </Button>
          )}
          <span
            className={`inventory-health ${healthy ? 'healthy' : 'warning'}`}
          >
            {healthy ? 'Inventario sano' : 'Atención requerida'}
          </span>
        </div>
      </div>
      <div className={`inventory-banner ${healthy ? 'healthy' : 'warning'}`}>
        <b>{healthy ? 'Inventario sano' : 'Revisa el inventario'}</b>
        <span>
          {query
            ? `${list.length} producto${list.length === 1 ? '' : 's'} encontrado${list.length === 1 ? '' : 's'} para “${query}”.`
            : healthy
              ? 'No hay productos bajos ni agotados.'
              : `${low + depleted} productos requieren tu atención.`}
        </span>
      </div>
      <div className="inventory-table-wrap">
        <table
          className={`inventory-table ${canSeeCosts ? '' : 'inventory-worker-table'} ${canManage ? '' : 'inventory-readonly-table'}`}
        >
          <thead>
            <tr>
              {canDelete && (
                <th>
                  <input
                    aria-label="Seleccionar todos"
                    type="checkbox"
                    checked={list.length > 0 && selected.length === list.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? list.map((p: any) => p.id) : [],
                      )
                    }
                  />
                </th>
              )}
              <th>Producto</th>
              <th>Categoría</th>
              <th>Código de barras</th>
              {canSeeCosts && <th>Costo</th>}
              <th>P. venta</th>
              {canSeeCosts && <th>Margen</th>}
              <th>Stock</th>
              <th>Min. stock</th>
              <th>Estado</th>
              {canManage && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((p: any) => {
              const margin = p.cost
                ? Math.round(((p.price - p.cost) / p.cost) * 100)
                : null;
              const state =
                p.stock === 0
                  ? 'Agotado'
                  : p.stock <= p.min
                    ? 'Bajo stock'
                    : 'Disponible';
              return (
                <tr key={p.id}>
                  {canDelete && (
                    <td className="mobile-select">
                      <input
                        aria-label={`Seleccionar ${p.name}`}
                        type="checkbox"
                        checked={selected.includes(p.id)}
                        onChange={() =>
                          setSelected((old) =>
                            old.includes(p.id)
                              ? old.filter((id) => id !== p.id)
                              : [...old, p.id],
                          )
                        }
                      />
                    </td>
                  )}
                  <td data-label="Producto">
                    <div className="product-cell">
                      {p.image ? (
                        <img
                          className="product-thumb product-photo"
                          src={p.image}
                          alt={p.name}
                        />
                      ) : (
                        <div className="product-thumb">
                          {p.name.slice(0, 1)}
                        </div>
                      )}
                      <div>
                        <b>{p.name}</b>
                        <span>{p.barcode || p.sku || 'Sin código'}</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Categoría">
                    {categories.includes(p.category)
                      ? p.category
                      : 'Sin categoría'}
                  </td>
                  <td data-label="Código">
                    {p.barcode || p.sku || 'Sin código'}
                  </td>
                  {canSeeCosts && (
                    <td data-label="Costo">{money.format(p.cost || 0)}</td>
                  )}
                  <td data-label="Precio" className="sale-price">
                    {money.format(p.price)}
                  </td>
                  {canSeeCosts && (
                    <td data-label="Margen" className="margin">
                      {margin === null ? '—' : `${margin}%`}
                    </td>
                  )}
                  <td data-label="Stock">
                    <b>{p.stock}</b> <small>uds</small>
                  </td>
                  <td data-label="Mínimo">{p.min}</td>
                  <td data-label="Estado">
                    <span
                      className={`product-status ${state === 'Disponible' ? 'available' : state === 'Bajo stock' ? 'low' : 'empty'}`}
                    >
                      {state}
                    </span>
                  </td>
                  {canManage && (
                    <td data-label="Acciones">
                      <div className="row-actions">
                        <Button
                          aria-label={`Editar ${p.name}`}
                          size="icon-sm"
                          variant="outline"
                          onClick={() => openEdit(p)}
                        >
                          <Pencil />
                        </Button>
                        {canDelete && (
                          <Button
                            className="inventory-delete"
                            size="sm"
                            onClick={() => deleteOne(p)}
                          >
                            <Trash2 />
                            Borrar
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && (
          <div className="inventory-empty">
            No encontramos productos con esos criterios.
          </div>
        )}
      </div>
      {canManage && editing && (
        <div className="inventory-modal-backdrop">
          <div className="inventory-modal">
            <div className="inventory-modal-heading">
              <div>
                <h3>
                  {editing === 'new'
                    ? 'Entrada de inventario'
                    : 'Editar producto'}
                </h3>
                <p>
                  {editing === 'new'
                    ? 'Registra costos, precio, categoría y existencias del producto.'
                    : 'Actualiza la información, existencias o imagen.'}
                </p>
              </div>
              <button aria-label="Cerrar" onClick={close}>
                <X />
              </button>
            </div>
            {formError && <div className="inventory-form-error" role="alert"><TriangleAlert /><span>{formError}</span></div>}
            <div className="inventory-form">
              <label>
                Categoría *
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm({ ...form, category: event.target.value })
                  }
                >
                  <option value="" disabled>
                    {categories.length
                      ? 'Selecciona una categoría'
                      : 'Primero crea una categoría'}
                  </option>
                  {categories.map((category: string) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              {[
                ['name', 'Producto *', 'Ej. Cargador rápido 25W'],
                ['barcode', 'Código de barras', 'Escanea con el lector láser'],
                ['cost', 'Costo de compra *', '0'],
                ['price', 'Precio de venta *', '0'],
                ['stock', 'Existencia inicial *', '0'],
                ['min', 'Stock mínimo', '0'],
              ]
                .filter(([key]) => canSeeCosts || key !== 'cost')
                .map(([key, label, placeholder]) => (
                  <label key={key}>
                    {label}
                    <input
                      type={
                        ['cost', 'price', 'stock', 'min'].includes(key)
                          ? 'number'
                          : 'text'
                      }
                      min="0"
                      value={(form as any)[key]}
                      onChange={(e) => {
                        setForm({ ...form, [key]: e.target.value });
                        if (key === 'barcode') setFormError('');
                      }}
                      placeholder={placeholder}
                    />
                  </label>
                ))}
            </div>
            <p className="inventory-cost-help">
              Costo de compra y precio de venta ayudan a conocer el margen
              disponible antes de hacer descuentos.
            </p>
            <div className="image-upload">
              <div>
                <b>Foto del producto</b>
                <span>Opcional. JPG, PNG o WEBP.</span>
              </div>
              <label className="upload-button">
                <ImagePlus />
                {form.image ? 'Cambiar imagen' : 'Subir imagen'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={upload}
                />
              </label>
              {form.image && (
                <div className="image-preview">
                  <img src={form.image} alt="Vista previa" />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, image: '' })}
                  >
                    Quitar imagen
                  </button>
                </div>
              )}
            </div>
            <div className="inventory-modal-actions">
              <Button variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button
                disabled={
                  !form.name.trim() ||
                  !categories.includes(form.category) ||
                  !form.price ||
                  form.stock === ''
                }
                className="inventory-primary"
                onClick={save}
              >
                {editing === 'new' ? 'Guardar producto' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        </div>
      )}
      {canManage && creatingCategory && (
        <div className="inventory-modal-backdrop">
          <form
            className="category-modal"
            onSubmit={(event) => {
              event.preventDefault();
              createCategory();
            }}
          >
            <div className="inventory-modal-heading">
              <div>
                <h3>Nueva categoría</h3>
                <p>
                  Crea categorías como Audífonos, Cargadores, Fundas o las que
                  necesite el negocio.
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => {
                  setCreatingCategory(false);
                  setNewCategory('');
                }}
              >
                <X />
              </button>
            </div>
            <label>
              Nombre de la categoría
              <input
                autoFocus
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="Ej. Audífonos"
              />
            </label>
            <div className="inventory-modal-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreatingCategory(false);
                  setNewCategory('');
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!newCategory.trim()}
                className="inventory-primary"
              >
                Guardar categoría
              </Button>
            </div>
          </form>
        </div>
      )}
      {canManage && canEditCategories && editingCategory && (
        <div className="inventory-modal-backdrop">
          <form
            className="category-modal"
            onSubmit={(event) => {
              event.preventDefault();
              saveCategoryName();
            }}
          >
            <div className="inventory-modal-heading">
              <div>
                <h3>Editar categoría</h3>
                <p>
                  El nuevo nombre se actualizará también en todos los productos
                  de esta categoría.
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => {
                  setEditingCategory(null);
                  setNewCategory('');
                }}
              >
                <X />
              </button>
            </div>
            <label>
              Nombre de la categoría
              <input
                autoFocus
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="Nombre de la categoría"
              />
            </label>
            {categories.some(
              (category: string) =>
                category !== editingCategory &&
                category.toLocaleLowerCase('es') ===
                  newCategory.trim().toLocaleLowerCase('es'),
            ) && (
              <p role="alert">Ya existe una categoría con ese nombre.</p>
            )}
            <div className="inventory-modal-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingCategory(null);
                  setNewCategory('');
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  !newCategory.trim() ||
                  categories.some(
                    (category: string) =>
                      category !== editingCategory &&
                      category.toLocaleLowerCase('es') ===
                        newCategory.trim().toLocaleLowerCase('es'),
                  )
                }
                className="inventory-primary"
              >
                Guardar cambios
              </Button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
function Stat({ icon, color, label, value, note }: any) {
  return (
    <article className="inventory-stat">
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}
