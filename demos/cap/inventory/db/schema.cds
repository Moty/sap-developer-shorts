namespace demo;

entity Products {
  key ID : UUID;
  title  : String(100);
  stock  : Integer;
}
