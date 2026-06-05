# RealPhone — Sistema Integral de Punto de Venta

Aplicación web moderna para gestión integral de tiendas de celulares y accesorios.

Este repositorio alberga dos aplicaciones principales:

- **RealPhone POS** (`/pos`) — Sistema de Punto de Venta con inventario, ventas, usuarios y reportes. Versión `1.1.0`.
- **Gestor de Tickets** (`/gestor-tickets`) — Gestión de tickets de reparación y servicios integrado con Firebase. Versión `1.0.1`.

Ambas aplicaciones funcionan de forma independiente pero pueden compartir datos e integrarse mediante APIs.

## Acceso

- **POS**: [pos/index.html](pos/index.html)
- **Gestor de Tickets**: [gestor-tickets/index.html](gestor-tickets/index.html)

## Tecnología

- Vanilla JavaScript (sin frameworks)
- LocalStorage + Firebase (Firestore)
- Responsive Design (Mobile-first)
- PWA ready (manifest.json)

## Desarrollo

```bash
# Instalar dependencias (gestor-tickets)
cd gestor-tickets
npm install

# Ejecutar pruebas
npm test
```
