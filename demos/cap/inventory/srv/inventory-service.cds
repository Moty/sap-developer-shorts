using { demo } from '../db/schema';

@path: 'inventory'
@requires: 'any'
service InventoryService {
  @readonly
  entity Products as projection on demo.Products;
}
