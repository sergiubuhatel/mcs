import CompanyFilters from "../features/companies/CompanyFilters";
import CompanyTable from "../features/companies/CompanyTable";
import SavePoolForm from "../features/pools/SavePoolForm";

export default function ScreenerPage() {
  return (
    <div>
      <CompanyFilters />
      <SavePoolForm />
      <CompanyTable />
    </div>
  );
}
