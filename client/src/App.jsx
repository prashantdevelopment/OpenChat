

const App = () => {

const fetchData = async () => {
  try {
    const response = await fetch('http://localhost:5000/api/health');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log(data);
  } catch (error) {
    console.error('Error fetching data:', error);
  }
};

  return (


    <div>
      <h1></h1>
      <button onClick={fetchData} >Click me</button>
    </div>
  )
}

export default App