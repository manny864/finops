import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.5,
  },
  header: {
    marginBottom: 30,
    borderBottomWidth: 2,
    borderBottomColor: '#0054A6',
    paddingBottom: 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0054A6',
    marginBottom: 5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  headerMeta: {
    fontSize: 9,
    color: '#999',
    marginTop: 10,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    backgroundColor: '#0054A6',
    color: '#fff',
    padding: 8,
    marginBottom: 10,
  },
  customerBlock: {
    padding: 10,
    backgroundColor: '#f5f5f5',
    marginBottom: 10,
    borderRadius: 3,
  },
  customerRow: {
    marginBottom: 5,
    display: 'flex',
    flexDirection: 'row',
  },
  customerLabel: {
    fontWeight: 'bold',
    width: '30%',
    color: '#333',
  },
  customerValue: {
    width: '70%',
    color: '#666',
  },
  summaryGrid: {
    display: 'flex',
    flexDirection: 'row',
    marginBottom: 20,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    padding: 12,
    backgroundColor: '#f9f9f9',
    borderLeftWidth: 4,
    borderLeftColor: '#0054A6',
  },
  summaryCardLabel: {
    fontSize: 9,
    color: '#999',
    marginBottom: 5,
  },
  summaryCardValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0054A6',
  },
  table: {
    marginBottom: 20,
  },
  tableHeader: {
    display: 'flex',
    flexDirection: 'row',
    backgroundColor: '#0054A6',
    color: '#fff',
    fontWeight: 'bold',
    paddingVertical: 8,
    paddingHorizontal: 5,
    borderRadius: 2,
  },
  tableRow: {
    display: 'flex',
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tableRowEven: {
    backgroundColor: '#f9f9f9',
  },
  tableRowOdd: {
    backgroundColor: '#fff',
  },
  tableRowTotal: {
    backgroundColor: '#e8f4f8',
    fontWeight: 'bold',
    borderTopWidth: 2,
    borderTopColor: '#0054A6',
    paddingVertical: 8,
  },
  tableCell: {
    flex: 1,
    paddingRight: 5,
  },
  tableCellDate: {
    flex: 0.9,
  },
  tableCellService: {
    flex: 1.2,
  },
  tableCellResourceGroup: {
    flex: 1.2,
  },
  tableCellCurrency: {
    flex: 0.9,
    textAlign: 'right',
  },
  footer: {
    marginTop: 40,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    fontSize: 8,
    color: '#999',
    textAlign: 'center',
  },
  footerRow: {
    marginBottom: 5,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 20,
    right: 30,
    fontSize: 8,
    color: '#999',
  },
});

interface LineItem {
  date: string;
  service: string;
  resourceGroup: string;
  originalCost: number;
  adjustedCost: number;
}

interface ShowbackInvoiceData {
  tenantName: string;
  tenantLogoUrl?: string;
  period: string;
  generatedDate: string;
  customerName: string;
  customerId: string;
  billingPeriod: string;
  originalCost: number;
  adjustedCost: number;
  markupPercent: number;
  markupAmount: number;
  currency: string;
  lines: LineItem[];
}

const formatCurrency = (value: number, currency: string): string => {
  const currencySymbol = currency === 'USD' ? '$' : currency === 'ARS' ? '$' : currency;
  return `${currencySymbol}${value.toFixed(2)}`;
};

const ShowbackInvoiceTemplate: React.FC<{ data: ShowbackInvoiceData; pageNumber?: number; totalPages?: number }> = ({
  data,
  pageNumber = 1,
  totalPages = 1,
}) => {
  const linePerPage = 15;
  const startIdx = (pageNumber - 1) * linePerPage;
  const endIdx = Math.min(startIdx + linePerPage, data.lines.length);
  const isFirstPage = pageNumber === 1;
  const isLastPage = pageNumber === totalPages;
  const displayLines = data.lines.slice(startIdx, endIdx);

  return (
    <Page size="A4" style={styles.page}>
      {isFirstPage && (
        <>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Showback / Chargeback Report</Text>
            <Text style={styles.headerSubtitle}>{data.tenantName}</Text>
            <Text style={styles.headerMeta}>
              Period: {data.period} | Generated: {data.generatedDate}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Billing Information</Text>
            <View style={styles.customerBlock}>
              <View style={styles.customerRow}>
                <Text style={styles.customerLabel}>Customer:</Text>
                <Text style={styles.customerValue}>{data.customerName}</Text>
              </View>
              <View style={styles.customerRow}>
                <Text style={styles.customerLabel}>Customer ID:</Text>
                <Text style={styles.customerValue}>{data.customerId}</Text>
              </View>
              <View style={styles.customerRow}>
                <Text style={styles.customerLabel}>Billing Period:</Text>
                <Text style={styles.customerValue}>{data.billingPeriod}</Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cost Summary</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryCardLabel}>Original Cost</Text>
                <Text style={styles.summaryCardValue}>
                  {formatCurrency(data.originalCost, data.currency)}
                </Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryCardLabel}>Markup ({data.markupPercent}%)</Text>
                <Text style={styles.summaryCardValue}>
                  {formatCurrency(data.markupAmount, data.currency)}
                </Text>
              </View>
              <View style={[styles.summaryCard, { borderLeftColor: '#22c55e' }]}>
                <Text style={styles.summaryCardLabel}>Total to Pay</Text>
                <Text style={[styles.summaryCardValue, { color: '#22c55e' }]}>
                  {formatCurrency(data.adjustedCost, data.currency)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Line Items</Text>
          </View>
        </>
      )}

      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableCell, styles.tableCellDate]}>Date</Text>
          <Text style={[styles.tableCell, styles.tableCellService]}>Service</Text>
          <Text style={[styles.tableCell, styles.tableCellResourceGroup]}>Resource Group</Text>
          <Text style={[styles.tableCell, styles.tableCellCurrency]}>Original Cost</Text>
          <Text style={[styles.tableCell, styles.tableCellCurrency]}>Adjusted Cost</Text>
        </View>

        {displayLines.map((line, idx) => {
          const isEven = idx % 2 === 0;
          return (
            <View
              key={`${startIdx + idx}`}
              style={[styles.tableRow, isEven ? styles.tableRowEven : styles.tableRowOdd]}
            >
              <Text style={[styles.tableCell, styles.tableCellDate]}>{line.date}</Text>
              <Text style={[styles.tableCell, styles.tableCellService]}>{line.service}</Text>
              <Text style={[styles.tableCell, styles.tableCellResourceGroup]}>
                {line.resourceGroup}
              </Text>
              <Text style={[styles.tableCell, styles.tableCellCurrency]}>
                {formatCurrency(line.originalCost, data.currency)}
              </Text>
              <Text style={[styles.tableCell, styles.tableCellCurrency]}>
                {formatCurrency(line.adjustedCost, data.currency)}
              </Text>
            </View>
          );
        })}

        {isLastPage && (
          <View style={styles.tableRowTotal}>
            <Text style={[styles.tableCell, styles.tableCellDate]}>TOTAL</Text>
            <Text style={[styles.tableCell, styles.tableCellService]} />
            <Text style={[styles.tableCell, styles.tableCellResourceGroup]} />
            <Text style={[styles.tableCell, styles.tableCellCurrency]}>
              {formatCurrency(data.originalCost, data.currency)}
            </Text>
            <Text style={[styles.tableCell, styles.tableCellCurrency]}>
              {formatCurrency(data.adjustedCost, data.currency)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerRow}>
          Generated by FinOps SaaS · CSCloudSolutions · cscloudsolutions.com.ar
        </Text>
        <Text style={styles.footerRow}>{new Date().toISOString()}</Text>
        <Text style={styles.pageNumber}>
          Page {pageNumber} of {totalPages}
        </Text>
      </View>
    </Page>
  );
};

interface RenderShowbackPdfOptions {
  data: ShowbackInvoiceData;
}

export async function renderShowbackPdf(options: RenderShowbackPdfOptions): Promise<Buffer> {
  const { data } = options;

  const totalPages = Math.ceil(data.lines.length / 15);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  const doc = (
    <Document>
      {pages.map((pageNum) => (
        <ShowbackInvoiceTemplate
          key={`page-${pageNum}`}
          data={data}
          pageNumber={pageNum}
          totalPages={totalPages}
        />
      ))}
    </Document>
  );

  const { pdf } = await import('@react-pdf/renderer');
  const blob = await pdf(doc).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}
