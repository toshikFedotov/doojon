import ejs from 'ejs';
import { File } from '@mojojs/core';
import prettier from 'prettier';

const SUBCOMMANDS = {
  generate: cliGenerate,
};

const SCHEMA_TEMPLATE = `
  export const schema = {
    'tables': {
    <% for (const table of schema.tables) { -%>
      '<%= table['table_name'] %>': {
      <% for (const column of table['columns']) { -%>
        '<%=column['column_name']%>': {
          'type': '<%=column['data_type']%>',
          <% if (column['is_primary_key']) { -%>
          'is_primary_key': true,
          <% } -%>
        },
      <% } %>
      },
    <% } %>
    },
    'enums': {
      <% for (const enumName of Object.keys(schema.enums)) { -%>
        '<%= enumName %>': [
        <% for (const el of schema.enums[enumName]) { -%>
          '<%=el%>',
        <% } -%>
        ],
      <% } %>
    }
  };
`;

const DATASERVICE_TEMPLATE = `
  import { Dataservice } from '../dataservice.js';

  export default class <%=classname%> extends Dataservice {
    static get _tablename() {
      return '<%=tablename%>'
    }
  }

`;

const NOT_DS_TABLES = ['knex_migrations', 'knex_migrations_lock'];

export default async function run(app, args) {
  const subcommand = SUBCOMMANDS[args[1]];

  if (!subcommand) {
    throw new Error('No such subcommand');
  }

  await subcommand.call(this, app);
}

async function cliGenerate(app) {
  const db = app.model._container.resolve('/h/db');
  const schemaDef = await _getSchema(db);
  const tables = schemaDef.tables;
  tables.sort((a, b) => (a['table_name'] > b['table_name'] ? 1 : -1));

  let schema = ejs.render(SCHEMA_TEMPLATE, { schema: schemaDef });

  await prettier
    .resolveConfig(app.home.child('.prettierrc.json').toString())
    .then(options => {
      options.parser = 'babel';
      schema = prettier.format(schema, options);
    });

  const schemafile = new File(
    app.home.child('src/model/schema.js').toString()
  );
  await schemafile.writeFile(schema);

  for (const table of tables) {
    const filename = table['table_name'] + '.js';
    const dsfile = new File(
      app.home.child(`src/model/dataservices/${filename}`).toString()
    );

    if (await dsfile.exists()) continue;

    const classname =
      table['table_name']
        .split('_')
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join('') + 'Dataservice';

    let dscode = ejs.render(DATASERVICE_TEMPLATE, {
      classname,
      tablename: table['table_name'],
    });

    await prettier
      .resolveConfig(app.home.child('.prettierrc.json').toString())
      .then(options => {
        options.parser = 'babel';
        dscode = prettier.format(dscode, options);
      });

    await dsfile.writeFile(dscode);
  }

  db.destroy();
}

function _translate_data_type(type) {
  if (type === 'boolean' || type === 'date' || type === 'ARRAY') {
    return type;
  } else if (/character|text|uuid/.test(type)) {
    return 'string';
  } else if (/bigint|integer|smallint/.test(type)) {
    return 'integer';
  } else if (/double|numeric|real/.test(type)) {
    return 'number';
  } else if (/timestamp/.test(type)) {
    return 'timestamp';
  } else if (/time/.test(type)) {
    return 'time';
  }

  throw new Error(`Unable to translate type ${type}`);
}

async function _getSchema(db) {
  let tables = await db
    .select('table_name')
    .from('information_schema.tables')
    .where({ 'table_schema': 'public' });

  tables = tables.filter(t => !NOT_DS_TABLES.includes(t['table_name']));

  const enums = {};

  for (let table of tables) {
    const tablename = table['table_name'];

    const columns = await db
      .select()
      .from('information_schema.columns')
      .where({ 'table_name': tablename, 'table_schema': 'public' });

    for (const col of columns) {
      if (col['data_type'] !== 'USER-DEFINED' ) {
        col['data_type'] = _translate_data_type(col['data_type']);
        continue;
      }

      const customEnum = col['udt_name'];
      col['data_type'] = customEnum;

      if (enums[customEnum])
        continue;

      const customEnumDefinition = await db.select(db.raw(`unnest(enum_range(NULL::${customEnum}))`));
      enums[customEnum] = customEnumDefinition.map(e => e.unnest);
    }

    const primaryKeys = await _getPrimaryKeys(db, tablename);

    for (const pkey of primaryKeys) {
      columns.find(c => c['column_name'] === pkey['column_name'])[
        'is_primary_key'
      ] = true;
    }

    columns.sort((a, b) => (a['column_name'] > b['column_name'] ? 1 : -1));
    table['columns'] = columns;
  }

  return { tables, enums };
}

async function _getPrimaryKeys(db, table) {
  return db
    .select('c.column_name')
    .from('information_schema.table_constraints as tc')
    .join({ ccu: 'information_schema.constraint_column_usage' }, function () {
      this.on('ccu.constraint_schema', '=', 'tc.constraint_schema').andOn(
        'ccu.constraint_name',
        '=',
        'tc.constraint_name'
      );
    })
    .join({ c: 'information_schema.columns' }, function () {
      this.on('c.table_schema', '=', 'tc.constraint_schema')
        .andOn('tc.table_name', '=', 'c.table_name')
        .andOn('ccu.column_name', '=', 'c.column_name');
    })
    .where({ 'constraint_type': 'PRIMARY KEY', 'tc.table_name': table });
}
