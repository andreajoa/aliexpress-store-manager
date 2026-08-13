# Store Connector — publicationTarget v1

O publicationTarget informa ao Store Manager como uma loja compatível pode receber produtos.

O Store Manager é independente das lojas conectadas.
Ele não deve inferir arquivos, diretórios, endpoints ou estruturas internas específicas de nenhuma loja.

## Princípio

Uma loja pode ser compatível para leitura, scan e inteligência sem necessariamente ser compatível para publicação.

Publicação exige um contrato publicationTarget explícito e válido.

## GitHub catalog

{
  "publicationTarget": {
    "contractVersion": "1",
    "kind": "github-catalog",
    "adapter": "github-json-catalog-v1",
    "catalogPath": "data/products.json",
    "editorialAssetsDir": "public/store-manager/products"
  }
}

## HTTP API

{
  "publicationTarget": {
    "contractVersion": "1",
    "kind": "http-api",
    "adapter": "store-product-api-v1",
    "endpointPath": "/products/upsert"
  }
}

## Fail closed

A publicação permanece bloqueada quando o publicationTarget está ausente ou inválido.
Versões desconhecidas, adapters não suportados e caminhos inseguros também são bloqueados.

O Manager nunca inventa caminhos ou contratos específicos de uma loja.

Leitura, scan e inteligência podem continuar funcionando mesmo quando a publicação não é compatível.

## Dry-run

O dry-run apenas simula alterações.
Ele não executa git push, Pull Request, deploy Vercel nem alteração de produção.
