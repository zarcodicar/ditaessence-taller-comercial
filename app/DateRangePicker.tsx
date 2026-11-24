'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

type Period =
  | 'specific'
  | 'last-7'
  | 'last-15'
  | 'last-month'
  | 'last-3-months'
  | 'last-year'
  | 'current-month'
  | 'current-year'
  | 'custom';

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const readable = (value: string) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'Seleccionar fecha';
const months = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function subtractDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() - amount);
  return result;
}

function subtractMonths(date: Date, amount: number) {
  const result = new Date(date.getFullYear(), date.getMonth() - amount, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}

function subtractYears(date: Date, amount: number) {
  return subtractMonths(date, amount * 12);
}

function inferredPeriod(from: string, to: string): Period {
  const today = new Date();
  const todayValue = iso(today);
  if (from && from === to) return 'specific';
  if (to === todayValue && from === iso(subtractDays(today, 6)))
    return 'last-7';
  if (to === todayValue && from === iso(subtractDays(today, 14)))
    return 'last-15';
  if (to === todayValue && from === iso(subtractMonths(today, 1)))
    return 'last-month';
  if (to === todayValue && from === iso(subtractMonths(today, 3)))
    return 'last-3-months';
  if (to === todayValue && from === iso(subtractYears(today, 1)))
    return 'last-year';
  if (
    to === todayValue &&
    from === iso(new Date(today.getFullYear(), today.getMonth(), 1))
  )
    return 'current-month';
  if (to === todayValue && from === iso(new Date(today.getFullYear(), 0, 1)))
    return 'current-year';
  return 'custom';
}

export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  const today = new Date();
  const todayValue = iso(today);
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState<'from' | 'to'>(() =>
    !from || to ? 'from' : 'to',
  );
  const [period, setPeriod] = useState<Period>(() => inferredPeriod(from, to));
  const pickerRef = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState(
    () => new Date(`${from || todayValue}T12:00:00`),
  );
  const years = Array.from(
    { length: 41 },
    (_, index) => today.getFullYear() - 20 + index,
  );
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);

  const openFor = (target: 'from' | 'to') => {
    if (period !== 'specific') setPeriod('custom');
    setSelecting(target);
    const selected = target === 'from' ? from : to;
    if (selected) setMonth(new Date(`${selected}T12:00:00`));
    setOpen(true);
  };

  const choose = (value: string) => {
    if (period === 'specific') {
      onFromChange(value);
      onToChange(value);
      setOpen(false);
      return;
    }
    if (selecting === 'from') {
      onFromChange(value);
      if (to && value > to) onToChange('');
      setSelecting('to');
    } else {
      if (from && value < from) {
        onFromChange(value);
        onToChange(from);
      } else onToChange(value);
      setOpen(false);
    }
  };

  const setRange = (start: Date, end = today) => {
    onFromChange(iso(start));
    onToChange(iso(end));
    setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    setSelecting('from');
    setOpen(false);
  };

  const changePeriod = (next: Period) => {
    setPeriod(next);
    if (next === 'specific') {
      onFromChange(todayValue);
      onToChange(todayValue);
      setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
      setSelecting('from');
      setOpen(true);
    } else if (next === 'last-7') setRange(subtractDays(today, 6));
    else if (next === 'last-15') setRange(subtractDays(today, 14));
    else if (next === 'last-month') setRange(subtractMonths(today, 1));
    else if (next === 'last-3-months') setRange(subtractMonths(today, 3));
    else if (next === 'last-year') setRange(subtractYears(today, 1));
    else if (next === 'current-month')
      setRange(new Date(today.getFullYear(), today.getMonth(), 1));
    else if (next === 'current-year')
      setRange(new Date(today.getFullYear(), 0, 1));
    else {
      setSelecting('from');
      setOpen(true);
    }
  };

  const changeMonth = (nextMonth: number) =>
    setMonth(new Date(month.getFullYear(), nextMonth, 1));
  const changeYear = (year: number) =>
    setMonth(new Date(year, month.getMonth(), 1));

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, []);

  return (
    <div className="modern-range" ref={pickerRef}>
      <label className="range-preset">
        <span>Periodo rápido</span>
        <select
          value={period}
          onChange={(event) => changePeriod(event.target.value as Period)}
        >
          <option value="specific">Día específico</option>
          <option value="last-7">Últimos 7 días</option>
          <option value="last-15">Últimos 15 días</option>
          <option value="last-month">Último mes</option>
          <option value="last-3-months">Últimos 3 meses</option>
          <option value="last-year">Último año</option>
          <option value="current-month">Mes actual</option>
          <option value="current-year">Año actual</option>
          <option value="custom">Rango personalizado</option>
        </select>
      </label>
      <div className="modern-range-trigger">
        <CalendarDays />
        <button
          className={selecting === 'from' && open ? 'active' : ''}
          onClick={() => openFor('from')}
        >
          <small>Desde</small>
          <b>{readable(from)}</b>
        </button>
        <i>—</i>
        <button
          className={selecting === 'to' && open ? 'active' : ''}
          onClick={() => openFor('to')}
        >
          <small>Hasta</small>
          <b>{readable(to)}</b>
        </button>
      </div>
      {open && (
        <div className="modern-calendar">
          <p className="calendar-target">
            Seleccionando:{' '}
            <b>
              {period === 'specific'
                ? 'día específico'
                : selecting === 'from'
                  ? 'fecha inicial'
                  : 'fecha final'}
            </b>
          </p>
          <header>
            <button
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
              aria-label="Mes anterior"
            >
              <ChevronLeft />
            </button>
            <div>
              <select
                value={month.getMonth()}
                onChange={(event) => changeMonth(Number(event.target.value))}
              >
                {months.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={month.getFullYear()}
                onChange={(event) => changeYear(Number(event.target.value))}
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
              aria-label="Mes siguiente"
            >
              <ChevronRight />
            </button>
          </header>
          <button
            className="calendar-today"
            onClick={() =>
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1))
            }
          >
            Hoy: {readable(todayValue)}
          </button>
          <div className="calendar-week">
            {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((day, index) => (
              <span key={`${day}${index}`}>{day}</span>
            ))}
          </div>
          <div className="calendar-days">
            {days.map((day) => {
              const value = iso(day);
              const otherMonth = day.getMonth() !== month.getMonth();
              const selected = value === from || value === to;
              const between = from && to && value > from && value < to;
              return (
                <button
                  key={value}
                  className={`${otherMonth ? 'other' : ''} ${selected ? 'selected' : ''} ${between ? 'between' : ''} ${value === todayValue ? 'today' : ''}`}
                  onClick={() => choose(value)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <footer>
            <button
              onClick={() => {
                onFromChange('');
                onToChange('');
                setPeriod('custom');
                setSelecting('from');
              }}
            >
              Limpiar
            </button>
            <button
              onClick={() => {
                setPeriod('specific');
                setRange(today, today);
              }}
            >
              Hoy
            </button>
            <button
              onClick={() => {
                setPeriod('last-7');
                setRange(subtractDays(today, 6));
              }}
            >
              Últimos 7 días
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
