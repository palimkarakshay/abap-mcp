@Metadata.allowExtensions: true
@EndUserText.label: 'Online Shop'
@AccessControl.authorizationCheck: #NOT_REQUIRED
@Search.searchable: true
@ObjectModel.semanticKey: [ 'OrderId' ]
define root view entity ZC_AC000000UXX
  provider contract transactional_query
  as projection on ZR_AC000000UXX
  association [1..1] to ZR_AC000000UXX as _BaseEntity on $projection.OrderUUID = _BaseEntity.OrderUUID

{
  key OrderUUID,
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.90
      OrderID,
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.90
      @Consumption.valueHelpDefinition: [ {
      entity.name: 'ZI_AC_VH_PRODUCTS',
      entity.element: 'Product',
      useForValidation: true
      } ]
      OrderedItem,
      OrderQuantity,
      RequestedDeliveryDate,
      TotalPrice,
      @Semantics.currencyCode: true
      Currency,
      OverallStatus,
      SalesOrderStatus,
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.90
      Salesorder,
      BgpfStatus,
      BgpgProcessName,
      ManageSalesOrderUrl,
      Notes,
      CreatedBy,
      CreatedAt,
      LastChangedBy,
      LastChangedAt,
      LocalLastChangedAt,
      _BaseEntity
}
